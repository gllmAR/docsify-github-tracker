window.$docsify = window.$docsify || {};
window.$docsify.plugins = (window.$docsify.plugins || []).concat(function (hook, vm) {
  hook.beforeEach(async function (content) {
    const githubTrackerRegex = /```githubtracker\nuser:(.*?)\nrepo:(.*?)\n(?:limit:(\d+))?\n```/;
    const match = content.match(githubTrackerRegex);
    
    if (!match) return content;
    
    const user = match[1].trim();
    const repo = match[2].trim();
    const maxEvents = match[3] ? parseInt(match[3].trim(), 10) : (vm.config.githubActivityLimit || 100);
    
    const response = await fetch(`https://api.github.com/repos/${user}/${repo}/events`);
    if (!response.ok) {
      return content.replace(githubTrackerRegex, "\n\n**GitHub Activity: Unable to fetch data.**");
    }
    
    const events = await response.json();
    let activityMarkdown = "\n\n## GitHub Activity\n";
    
    events.slice(0, maxEvents).forEach(event => {
      const eventType = event.type.replace("Event", "");
      const actor = event.actor.login;
      const action = event.payload.action || "performed";
      const link = `https://github.com/${user}/${repo}`;
      activityMarkdown += `- **${actor}** ${action} ${eventType} in [${repo}](${link})\n`;
    });
    
    return content.replace(githubTrackerRegex, activityMarkdown);
  });
});
