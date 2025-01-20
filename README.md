# docsify-github-tracker

> GitHub activity tracker plugin for Docsify - Display repository events with date filtering


docsify-github-tracker

Include in Docsify `index.html`

```html
<script src="https://gllmar.github.io/docsify-github-tracker/docsify-github-tracker.js"></script>
```



### Configuration

- `user`: GitHub username (required)
- `repo`: Repository name (required) 
- `limit`: Number of events to fetch (default: 50)
- `debug`: Show debug logs (default: false)


## By default

```githubtracker
user:gllmar
repo:docsify-github-tracker
```


## with date limit

```githubtracker
user:gllmar
repo:docsify-github-tracker
limit:900
debug:true
start:2025/01/18
stop:2025/01/20
```
## with date before limit 

```githubtracker
user:gllmar
repo:docsify-github-tracker
limit:900
debug:true
start:2025/01/02
stop:2025/01/03
```
## with date in futur 

```githubtracker
user:gllmar
repo:docsify-github-tracker
limit:900
debug:true
start:2025/11/02
stop:2025/11/03
```