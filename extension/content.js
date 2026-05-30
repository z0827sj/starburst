(function () {
  'use strict'

  var API = 'http://localhost:3001'

  function parseRepo() {
    var m = location.pathname.match(/^\/([^/]+)\/([^/]+)/)
    if (!m) return null
    if (['settings','marketplace','notifications','explore','orgs','new','codespaces'].indexOf(m[1]) !== -1) return null
    return { owner: m[1], name: m[2].split('/')[0] }
  }

  function fmt(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
    return n.toLocaleString()
  }

  function stat(label, value) {
    return '<div class="sb-stat"><span>' + label + '</span><span class="sb-stat-val">' + value + '</span></div>'
  }

  var container = document.createElement('div')
  container.id = 'sb-container'
  container.innerHTML = '<div id="sb-header"><h2>✦ StarBurst</h2><button id="sb-close">&times;</button></div><div id="sb-body"><div class="sb-loading">Loading...</div></div><div id="sb-status">StarBurst · localhost:3001</div>'
  document.body.appendChild(container)

  var toggle = document.createElement('button')
  toggle.id = 'sb-toggle'
  toggle.textContent = '✦'
  toggle.title = 'StarBurst sidebar'
  document.body.appendChild(toggle)

  var open = false
  function setOpen(v) { open = v; container.classList.toggle('open', v); toggle.style.opacity = v ? '0' : '1' }
  toggle.addEventListener('click', function () { setOpen(true) })
  document.getElementById('sb-close').addEventListener('click', function () { setOpen(false) })

  async function load() {
    var repo = parseRepo()
    var body = document.getElementById('sb-body')
    if (!repo) { body.innerHTML = '<div class="sb-empty">Navigate to a repo to see StarBurst insights.</div>'; return }
    body.innerHTML = '<div class="sb-loading">Loading ' + repo.owner + '/' + repo.name + '...</div>'

    try {
      var meta, bursts, eco
      try { meta = await (await fetch(API + '/api/github/repo/' + repo.owner + '/' + repo.name)).json() } catch(e) { meta = { error: true } }
      try { bursts = await (await fetch(API + '/api/repo/' + repo.owner + '/' + repo.name + '/bursts')).json() } catch(e) { bursts = { bursts: [], growth: [] } }
      try { eco = await (await fetch(API + '/api/repo/' + repo.owner + '/' + repo.name + '/ecosystem')).json() } catch(e) { eco = null }

      var hasBursts = (bursts.bursts || []).length > 0
      var growth = bursts.growth || []
      var lastGrowth = growth.length > 0 ? growth[growth.length - 1].total : 0
      var html = ''

      if (!meta.error) {
        html += '<div class="sb-section"><h3>📊 Repo Stats</h3>'
        html += stat('Stars', fmt(meta.stars))
        html += stat('Forks', fmt(meta.forks))
        html += stat('Issues', fmt(meta.open_issues))
        html += stat('Language', meta.language || 'N/A')
        html += '</div>'
      }

      html += '<div class="sb-section"><h3>🛰️ Local Monitor</h3>'
      html += stat('Bursts', hasBursts ? String(bursts.bursts.length) : '0')
      html += stat('Events (24h)', fmt(lastGrowth))
      html += '</div>'

      if (eco && eco.scoreBreakdown && eco.scoreBreakdown.length) {
        html += '<div class="sb-section"><h3>🌍 Ecosystem</h3>'
        html += stat('Health Score', Math.round(eco.score) + '/100')
        for (var i = 0; i < eco.scoreBreakdown.length; i++) {
          html += '<div style="font-size:11px;color:#656d76;padding:2px 0">' + eco.scoreBreakdown[i] + '</div>'
        }
        html += '</div>'
      }

      if (hasBursts) {
        html += '<div class="sb-section"><h3>🔥 Recent Bursts</h3>'
        var list = bursts.bursts.slice(0, 5)
        for (var j = 0; j < list.length; j++) {
          var b = list[j]; var v = (b.star_count / b.window_minutes).toFixed(1)
          html += '<div class="sb-burst"><strong>+' + b.star_count + '★</strong> in ' + b.window_minutes + 'min (' + v + '/min)</div>'
        }
        html += '</div>'
      }

      html += '<div style="text-align:center;margin-top:8px"><a class="sb-link" href="http://localhost:5173/#/repo/' + repo.owner + '/' + repo.name + '" target="_blank">Open in StarBurst →</a></div>'
      body.innerHTML = html
    } catch(e) {
      body.innerHTML = '<div class="sb-empty">StarBurst server not reachable.<br>Start: cd star-burst && npm run dev</div>'
    }
  }

  var lastPath = location.pathname
  load()
  setInterval(function () {
    if (location.pathname !== lastPath) { lastPath = location.pathname; load() }
  }, 2000)
})()
