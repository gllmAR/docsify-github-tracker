(function () {
  const defaultOptions = {
    limit: 50,
    debug: true,
    cacheTime: 5 * 60 * 1000, // 5 minutes
    checkInterval: 30 * 1000   // 30 seconds minimum between checks
  };

  // Cache management
  const cache = {
    get: async (key, user, repo) => {
      const item = localStorage.getItem(key);
      if (!item) return null;
      
      const { data, timestamp, etag } = JSON.parse(item);
      
      try {
        // Use conditional request to check if repo changed
        const response = await fetch(`https://api.github.com/repos/${user}/${repo}`, {
          headers: { 'If-None-Match': etag }
        });
        
        // If content changed (not 304), invalidate cache
        if (response.status !== 304) {
          log('Repository updated, invalidating cache');
          localStorage.removeItem(key);
          return null;
        }
        
        return data;
      } catch (err) {
        log('Error checking repo:', err);
        // Fall back to time-based cache on error
        if (Date.now() - timestamp > defaultOptions.cacheTime) {
          localStorage.removeItem(key);
          return null;
        }
        return data;
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
      const repoUrl = event.repo.url.replace('api.github.com/repos', 'github.com');
      const userUrl = `https://github.com/${event.repo.name.split('/')[0]}`;
  
      // Handle different event types
      switch(event.type) {
        case 'PushEvent':
          const commits = event.payload.commits.map(commit => 
            `  - ${commit.message} ([${commit.sha.substring(0,7)}](${repoUrl}/commit/${commit.sha}))`
          ).join('\n');
          details = `to \`${event.payload.ref.replace('refs/heads/', '')}\`\n${commits}`;
          break;
  
        case 'CreateEvent':
          const refType = event.payload.ref_type;
          const ref = event.payload.ref;
          details = refType === 'branch' ? 
            ` \`${ref}\`` : 
            ` ${refType}${ref ? ': ' + ref : ''}`;
          break;
  
        case 'IssuesEvent':
          details = ` [#${event.payload.issue.number}](${repoUrl}/issues/${event.payload.issue.number}) ${event.payload.action}: ${event.payload.issue.title}`;
          break;
  
        case 'PullRequestEvent':
          details = ` [#${event.payload.pull_request.number}](${repoUrl}/pull/${event.payload.pull_request.number}) ${event.payload.action}: ${event.payload.pull_request.title}`;
          break;
  
        case 'IssueCommentEvent':
          const issueNum = event.payload.issue.number;
          details = ` on [#${issueNum}](${repoUrl}/issues/${issueNum}): ${event.payload.comment.body.substring(0, 60)}...`;
          break;
      }
  
      return `- ${date}: ${type}${details}`;
    } catch (err) {
      log('Error formatting event:', err);
      return '';
    }
  }

  function formatHeader(user, repo, start, stop) {
    const repoUrl = `https://github.com/${user}/${repo}`;
    const userUrl = `https://github.com/${user}`;
    let header = `## Repository: [${repo}](${repoUrl}) by [${user}](${userUrl})`;
    
    if (start && stop) {
      // Parse dates for header
      const startTime = parseDateTime(start);
      const stopTime = parseDateTime(stop);
      if (startTime && stopTime) {
        const startDate = new Date(startTime).toLocaleDateString();
        const stopDate = new Date(stopTime).toLocaleDateString();
        header += `\nEvents from ${startDate} to ${stopDate}`;
      }
    } else {
      header += `\nLatest events`;
    }
    
    return header + '\n\n';
  }

  function parseDateTime(dateStr) {
    try {
      log('Parsing date input:', dateStr);
      const [year, month, day] = dateStr.split('/').map(Number);
      
      // Validate date components
      if (!year || !month || !day) {
        throw new Error('Invalid date format. Use YYYY/MM/DD');
      }
      
      // Create UTC date at start of day
      const date = new Date(Date.UTC(year, month - 1, day));
      
      // Validate date is valid
      if (isNaN(date.getTime())) {
        throw new Error('Invalid date');
      }
      
      log('Parsed date:', {
        input: dateStr,
        parsed: date.toISOString(),
        timestamp: date.getTime()
      });
      
      return date.getTime();
    } catch (err) {
      log('Error parsing date:', err);
      return null;
    }
  }

  function filterEventsByDate(events, start, stop) {
    if (!start && !stop) return events;
    
    const startTime = start ? parseDateTime(start) : 0;
    const stopTime = stop ? parseDateTime(stop) + (24 * 60 * 60 * 1000) : Infinity; // Add 24 hours to include full day
    
    log('Date filter:', {
      startTime: new Date(startTime).toISOString(),
      stopTime: stopTime === Infinity ? 'Infinity' : new Date(stopTime).toISOString()
    });
    
    return events.filter(event => {
      const eventTime = new Date(event.created_at).getTime();
      const inRange = eventTime >= startTime && eventTime < stopTime;
      
      log('Event check:', {
        event: event.type,
        time: new Date(eventTime).toISOString(),
        inRange,
        startTime,
        stopTime
      });
      
      return inRange;
    });
  }

  function getCacheKey(user, repo, start, stop) {
    let key = `gh-tracker-${user}-${repo}`;
    if (start && stop) {
      key += `-${start}-${stop}`;
    }
    log('Cache key:', key);
    return key;
  }

  async function fetchEvents(user, repo, limit, start, stop) {
    try {
      const cacheKey = getCacheKey(user, repo, start, stop);
      const cached = await cache.get(cacheKey, user, repo);
      if (cached) {
        log('Using cached data');
        return cached;
      }

      const url = `https://api.github.com/repos/${user}/${repo}/events?per_page=${limit}`;
      log('Fetching from:', url);

      const response = await fetch(url);
      const allEvents = await response.json();
      
      let filteredEvents = allEvents;
      if (start || stop) {
        const startTime = start ? parseDateTime(start) : 0;
        const stopTime = stop ? parseDateTime(stop) + (24 * 60 * 60 * 1000) : Infinity;
        
        filteredEvents = allEvents.filter(event => {
          const eventTime = new Date(event.created_at).getTime();
          return eventTime >= startTime && eventTime < stopTime;
        });
      }

      const header = formatHeader(user, repo, start, stop);
      if (filteredEvents.length === 0) {
        const noEvents = `${header}No events found in specified date range`;
        await cache.set(cacheKey, noEvents, user, repo);
        return noEvents;
      }

      const formatted = header + filteredEvents.map(formatEvent).filter(Boolean).join('\n');
      await cache.set(cacheKey, formatted, user, repo);
      return formatted;

    } catch (err) {
      log('Error:', err);
      return formatHeader(user, repo, start, stop) + `Error: ${err.message}`;
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
          const { user, repo, limit, start, stop } = tracker.config;
          const events = await fetchEvents(user, repo, limit, start, stop);
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