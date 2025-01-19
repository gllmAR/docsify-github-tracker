(function () {
  const defaultOptions = {
    limit: 50,
    debug: true,
    cacheTime: 5 * 60 * 1000 // 5 minutes
  };

  // Cache management
  const cache = {
    get: async (key, user, repo) => {
      const item = localStorage.getItem(key);
      if (!item) return null;
      
      const { data, timestamp, etag } = JSON.parse(item);
      
      // Check if cache is too old
      if (Date.now() - timestamp > defaultOptions.cacheTime) {
        localStorage.removeItem(key);
        return null;
      }

      try {
        // Use conditional request to check if repo changed
        const response = await fetch(`https://api.github.com/repos/${user}/${repo}`, {
          headers: { 'If-None-Match': etag }
        });
        
        if (response.status !== 304) {
          // Content changed, invalidate cache
          log('Repository updated, invalidating cache');
          localStorage.removeItem(key);
          return null;
        }
        
        return data;
      } catch (err) {
        log('Error checking repo:', err);
        return data; // Fall back to time-based cache
      }
    },
    
    set: async (key, data, user, repo) => {
      try {
        const response = await fetch(`https://api.github.com/repos/${user}/${repo}`);
        const etag = response.headers.get('ETag');
        
        localStorage.setItem(key, JSON.stringify({
          data,
          timestamp: Date.now(),
          etag
        }));
      } catch (err) {
        log('Error saving cache:', err);
        localStorage.setItem(key, JSON.stringify({
          data,
          timestamp: Date.now()
        }));
      }
    }
  };

  function log(message, data) {
    if (defaultOptions.debug) {
      console.log(`[GitHub Tracker] ${message}`, data || '');
    }
  }

  function parseGithubTracker(content) {
    log('Parsing content:', content);
    
    if (typeof content !== 'string') {
      log('Invalid content type:', typeof content);
      return [];
    }

    const regex = /```githubtracker\s*\n([\s\S]*?)\n```/g;
    const matches = [];
    let match;

    while ((match = regex.exec(content)) !== null) {
      const config = {};
      const lines = match[1].split('\n');
      
      lines.forEach(line => {
        const [key, value] = line.split(':').map(s => s.trim());
        if (key && value) {
          config[key] = value;
        }
      });

      matches.push({
        raw: match[0],
        config: { ...defaultOptions, ...config }
      });
    }

    log('Parsed matches:', matches);
    return matches;
  }

  function formatEvent(event) {
    try {
      const date = new Date(event.created_at).toLocaleString();
      const type = event.type.replace('Event', '');
      let details = '';
  
      switch(event.type) {
        case 'PushEvent':
          const commits = event.payload.commits.map(commit => 
            `  - ${commit.message} ([${commit.sha.substring(0,7)}](${event.repo.url}/commit/${commit.sha}))`
          ).join('\n');
          details = `\n${commits}`;
          break;
  
        case 'CreateEvent':
          details = ` ${event.payload.ref_type}${event.payload.ref ? ': ' + event.payload.ref : ''}`;
          if (event.payload.description) {
            details += `\n  - ${event.payload.description}`;
          }
          break;
  
        case 'IssuesEvent':
          details = ` #${event.payload.issue.number} ${event.payload.action}: ${event.payload.issue.title}`;
          break;
  
        case 'PullRequestEvent':
          details = ` #${event.payload.pull_request.number} ${event.payload.action}: ${event.payload.pull_request.title}`;
          break;
  
        case 'IssueCommentEvent':
          details = ` on #${event.payload.issue.number}: ${event.payload.comment.body.substring(0, 60)}...`;
          break;
      }
  
      const url = event.repo.url.replace('api.github.com/repos', 'github.com');
      return `- ${date}: ${type} - [${event.repo.name}](${url})${details}`;
    } catch (err) {
      log('Error formatting event:', err);
      return '';
    }
  }

  async function fetchEvents(user, repo, limit) {
    try {
      const cacheKey = `gh-tracker-${user}-${repo}`;
      const cached = await cache.get(cacheKey, user, repo);
      if (cached) {
        log('Using cached data');
        return cached;
      }

      const url = `https://api.github.com/repos/${user}/${repo}/events?per_page=${limit}`;
      log('Fetching from:', url);

      const response = await fetch(url);
      
      // Handle rate limiting
      const rateLimit = {
        limit: response.headers.get('X-RateLimit-Limit'),
        remaining: response.headers.get('X-RateLimit-Remaining'),
        reset: new Date(response.headers.get('X-RateLimit-Reset') * 1000)
      };
      
      log('Rate limit:', rateLimit);

      if (!response.ok) {
        if (response.status === 403 && rateLimit.remaining === '0') {
          return `GitHub API rate limit exceeded. Resets at ${rateLimit.reset.toLocaleString()}`;
        }
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const events = await response.json();
      const formatted = events.map(formatEvent).filter(Boolean).join('\n');
      
      if (formatted) {
        await cache.set(cacheKey, formatted, user, repo);
      }
      
      // Add rate limit warning if needed
      if (parseInt(rateLimit.remaining) < 10) {
        return `> ⚠️ GitHub API rate limit: ${rateLimit.remaining} requests remaining. Resets at ${rateLimit.reset.toLocaleString()}\n\n${formatted}`;
      }
      
      return formatted || 'No events found';
    } catch (err) {
      log('Error fetching events:', err);
      return `Error fetching GitHub events: ${err.message}`;
    }
  }

  function githubTracker(hook) {
    hook.beforeEach((content, next) => {
      if (!content || typeof content !== 'string') {
        next(content);
        return;
      }

      const trackers = parseGithubTracker(content);
      if (!trackers.length) {
        next(content);
        return;
      }

      Promise.all(
        trackers.map(async tracker => {
          const { user, repo, limit } = tracker.config;
          const events = await fetchEvents(user, repo, limit);
          return { raw: tracker.raw, events };
        })
      ).then(results => {
        let newContent = content;
        results.forEach(({ raw, events }) => {
          if (events && raw) {
            newContent = newContent.replace(raw, events);
          }
        });
        next(newContent);
      }).catch(err => {
        log('Plugin error:', err);
        next(content);
      });
    });
  }

  // Register plugin
  if (window.$docsify) {
    window.$docsify = window.$docsify || {};
    window.$docsify.plugins = [].concat(
      window.$docsify.plugins || [],
      githubTracker
    );
  }
})();