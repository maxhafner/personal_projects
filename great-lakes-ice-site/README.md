# Great Lakes Ice Watch

A lightweight website that visualizes Great Lakes ice cover with:

- Lake-shaped ice fill meters for each lake
- Live latest percentages (NOAA GLERL)
- Historical trend lines and 7-day change labels

## Run locally

Run with the built-in proxy server (recommended):

```bash
cd /Users/maxhafner/personal_projects/great-lakes-ice-site
python3 server.py --port 8080
```

Then open [http://localhost:8080](http://localhost:8080).

Why this server is needed:
- Some browsers block direct cross-origin requests to NOAA from static pages.
- `server.py` proxies NOAA data via `/api/ice-latest` and `/api/ice-history`.

## Data source

- NOAA GLERL ERDDAP dataset page:
  https://apps.glerl.noaa.gov/erddap/info/glerlIce/index.html
- Endpoints used by this site:
  - `https://apps.glerl.noaa.gov/erddap/tabledap/glerlIce.json?time,Superior,Michigan,Huron,Erie,Ontario,GL_Total`
  - `https://apps.glerl.noaa.gov/erddap/tabledap/glerlIce.json?time,Superior,Michigan,Huron,Erie,Ontario,GL_Total&orderByMax(%22time%22)`
