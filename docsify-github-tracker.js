(function () {
  const defaultOptions = {
    limit: 50,
    debug: true,
    cacheTime: 60 * 60 * 1000, // 1 hour cache
    checkInterval: 30 * 1000    // 30 seconds minimum between checks
  };

  // Cache management
  const cache = {
    init: () => {
      if (!localStorage.getItem('gh-tracker-initialized')) {
        localStorage.clear();
        localStorage.setItem('gh-tracker-initialized', 'true');
      }
    },

    get: async (key, user, repo) => {
      const item = localStorage.getItem(key);
      if (!item) return null;
      
      const cached = JSON.parse(item);
      const now = Date.now();
      
      // Always return cached data during rate limit
      if (cached.rateLimited && now < cached.rateLimitReset) {
        log('Rate limited, using cache:', {
          resetsIn: Math.round((cached.rateLimitReset - now) / 1000)
        });
        return cached.data;
      }
      
      // Check cache validity
      if (now - cached.timestamp < defaultOptions.cacheTime) {
        log('Cache hit:', key);
        return cached.data;
      }
      
      return null;
    },

    set: async (key, data, user, repo, rateLimited = false, rateLimitReset = null) => {
      const cacheData = {
        data,
        timestamp: Date.now(),
        rateLimited,
        rateLimitReset
      };
      
      log('Setting cache:', { key, rateLimited });
      localStorage.setItem(key, JSON.stringify(cacheData));
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

  function getEventIcon(type) {
    const icons = {
      PushEvent: { emoji: '🚀', label: 'Push to repository' },
      CreateEvent: { emoji: '🌿', label: 'Create branch/tag' },
      DeleteEvent: { emoji: '🗑️', label: 'Delete branch/tag' },
      PullRequestEvent: { emoji: '🔀', label: 'Pull Request' },
      IssuesEvent: { emoji: '🎯', label: 'Issue' },
      IssueCommentEvent: { emoji: '💬', label: 'Comment' },
      ReleaseEvent: { emoji: '📦', label: 'Release' },
      WatchEvent: { emoji: '⭐', label: 'Star' },
      ForkEvent: { emoji: '🍴', label: 'Fork' },
      PublicEvent: { emoji: '🌍', label: 'Made public' }
    };
    return icons[type] || { emoji: '📝', label: 'Other event' };
  }

  function getActionIcon(action) {
    const icons = {
      opened: { emoji: '➕', label: 'Opened' },
      closed: { emoji: '✅', label: 'Closed' },
      reopened: { emoji: '🔄', label: 'Reopened' },
      merged: { emoji: '🔗', label: 'Merged' },
      created: { emoji: '🆕', label: 'Created' },
      deleted: { emoji: '🗑️', label: 'Deleted' },
      commented: { emoji: '💬', label: 'Commented' }
    };
    return icons[action] || { emoji: action, label: action };
  }

  function formatEvent(event) {
    try {
      const date = new Date(event.created_at).toLocaleString([], { 
        month: '2-digit', 
        day: '2-digit',
        hour: '2-digit', 
        minute: '2-digit'
      });
      
      const icon = getEventIcon(event.type);
      const repoUrl = event.repo.url.replace('api.github.com/repos', 'github.com');
      let details = '';

      switch(event.type) {
        case 'PushEvent':
          const branch = event.payload.ref.replace('refs/heads/', '');
          details = `→ \`${branch}\``;
          if (event.payload.commits && event.payload.commits.length) {
            const commits = event.payload.commits.map(commit => 
              `  - ${commit.message} ([${commit.sha.substring(0,7)}](${repoUrl}/commit/${commit.sha}))`
            ).join('\n');
            details += `\n${commits}`;
          }
          break;

        case 'PullRequestEvent':
          const prAction = getActionIcon(event.payload.action);
          details = `<span title="${prAction.label}">${prAction.emoji}</span> [#${event.payload.pull_request.number}](${repoUrl}/pull/${event.payload.pull_request.number}) ${event.payload.pull_request.title}`;
          break;

        case 'IssuesEvent':
          const issueAction = getActionIcon(event.payload.action);
          details = `${issueAction} [#${event.payload.issue.number}](${repoUrl}/issues/${event.payload.issue.number}) ${event.payload.issue.title}`;
          break;

        case 'IssueCommentEvent':
          details = `💬 [#${event.payload.issue.number}](${repoUrl}/issues/${event.payload.issue.number}) ${event.payload.comment.body.substring(0,60)}...`;
          break;

        case 'CreateEvent':
          const refType = event.payload.ref_type;
          const ref = event.payload.ref;
          details = `${refType}${ref ? `: \`${ref}\`` : ''}`;
          break;
      }

      return `- <span title="${icon.label}">${icon.emoji}</span> ${date} ${details}\n`;
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
      cache.init();
      const cacheKey = getCacheKey(user, repo, start, stop);
      const cached = await cache.get(cacheKey, user, repo);
      if (cached) return cached;

      const response = await fetch(`https://api.github.com/repos/${user}/${repo}/events?per_page=${limit}`);
      
      if (response.status === 403) {
        const resetTime = response.headers.get('X-RateLimit-Reset') * 1000;
        const error = `## GitHub API Rate Limit Exceeded\n\nPlease try again after ${new Date(resetTime).toLocaleString()}`;
        await cache.set(cacheKey, error, user, repo, true, resetTime);
        return error;
      }

      // Handle other errors
      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }

      // Continue with existing logic
      const data = await response.json();
      // Ensure we have an array of events
      if (!Array.isArray(data)) {
        log('API response is not an array:', data);
        throw new Error('Invalid API response format');
      }

      let filteredEvents = [...data];
      if (start || stop) {
        const startTime = start ? parseDateTime(start) : 0;
        const stopTime = stop ? parseDateTime(stop) + (24 * 60 * 60 * 1000) : Infinity;
        
        log('Filtering events:', { 
          total: filteredEvents.length,
          startTime,
          stopTime
        });

        filteredEvents = filteredEvents.filter(event => {
          const eventTime = new Date(event.created_at).getTime();
          return eventTime >= startTime && eventTime < stopTime;
        });

        log('Filtered events:', {
          remaining: filteredEvents.length
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