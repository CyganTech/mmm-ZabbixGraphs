# MMM-ZabbixGraphs

`MMM-ZabbixGraphs` is a [MagicMirror²](https://magicmirror.builders/) module that renders PNG graphs exported from Zabbix.
It authenticates against the Zabbix JSON-RPC API, fetches metadata with `graph.get`/`graphitem.get`, and periodically refreshes
an image downloaded from `chart2.php`. The helper gracefully handles authentication errors, network timeouts, and token refreshes
so the MagicMirror front-end can focus on simply displaying the latest graph.

## Features

- Displays any graph you can access inside the Zabbix web UI.
- Supports both username/password logins and API tokens (available in earlier Zabbix releases but validated here against 7.2).
- Periodically refreshes the PNG on a configurable schedule so your mirror always shows the latest data.
- Lets you fine-tune Zabbix's **Period**, **From**, and *time shift* controls from the MagicMirror config.
- Surfaces friendly errors in the UI when API calls or PNG downloads fail.

## Installation

1. Change into your MagicMirror `modules` directory and clone/copy this folder:
   ```bash
   cd ~/MagicMirror/modules
   git clone https://github.com/CyganTech/mmm-ZabbixGraphs.git MMM-ZabbixGraphs
   cd MMM-ZabbixGraphs
   npm install
   ```
2. Restart MagicMirror after editing your configuration.

### Update

From your MagicMirror checkout, pull the latest changes and reinstall dependencies before restarting:

```bash
cd ~/MagicMirror/modules/MMM-ZabbixGraphs
git pull # or: git pull origin <branch>
npm install
```

## Configuration

Add the module to your `config.js`:

```js
{
  module: "MMM-ZabbixGraphs",
  position: "top_left",
  config: {
    zabbixUrl: "https://zabbix.example.com/zabbix",
    // Either keep username/password for deployments that prefer session authentication ...
    username: "api-user",
    password: "superSecret",
    // ...or drop the credentials above and provide an API token (validated on Zabbix 7.2)
    // apiToken: "eyJra...",
    // Option 1: point directly at a graph ID.
    graphId: 12345,
    // Option 2: resolve the graph from a dashboard widget (leave graphId unset).
    // dashboardId: 42,
    // widgetId: 17,
    // widgetName: "Traffic overview",
    width: 800,
    height: 300,
    refreshMinutes: 5,
    requestTimeoutMs: 10000,
    period: 24 * 60 * 60,
    // Optional overrides for Zabbix's From/To controls
    // stime: "now-24h",
    // timeShift: "0"
  }
}
```

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `zabbixUrl` | `string` | `http://localhost/zabbix` | Base URL of your Zabbix frontend. The helper automatically appends `api_jsonrpc.php` for API calls and `chart2.php` for graph downloads. |
| `username` | `string` | `""` | Zabbix username that is allowed to access the graph. Optional when `apiToken` is set. |
| `password` | `string` | `""` | Password for the user above. Optional when `apiToken` is set. |
| `apiToken` | `string` | `""` | Bearer token generated via **Administration → API → Tokens** (supported in prior Zabbix releases and validated with 7.2). When present the helper skips `user.login` and authenticates every request (including PNG downloads) via `Authorization: Bearer`. |
| `graphId` | `number` | `null` | ID of the Zabbix graph to display (find it in the URL while viewing the graph inside Zabbix). |
| `dashboardId` | `number` | `null` | Numeric ID of the dashboard that contains the widget you want to mirror. Required when `graphId` is omitted. |
| `widgetId` | `number\|string` | `null` | Optional widget identifier inside the dashboard. When present, the helper resolves that widget and reuses its configured graph. |
| `widgetName` | `string` | `null` | Optional widget title filter used when `widgetId` is not set. The first graph widget whose title matches this string is used. |
| `width` | `number` | `600` | Width in pixels used when requesting the PNG via `chart2.php`. |
| `height` | `number` | `300` | Height in pixels used for the PNG request. |
| `refreshMinutes` | `number` | `5` | Interval, in minutes, between refreshes. Each refresh reuses the cached auth token and requests a new PNG. Use `refreshInterval` (milliseconds) for backwards compatibility. |
| `requestTimeoutMs` | `number` | `10000` | Milliseconds before JSON-RPC and PNG requests are aborted. When exceeded the helper surfaces a readable error, clears the cached session token, and the module retries on the next scheduled refresh. |
| `period` | `number` | `86400` (24h) | Length of the requested window in seconds. This maps directly to Zabbix's **Period** slider / **To** field so the PNG shows the same span you'd see when choosing a preset like *Last 1 day* in the UI. |
| `stime` | `string\|null` | `null` | Optional override for Zabbix's **From** value (e.g., `"now-7d"` or a Unix timestamp). Leave `null` to let Zabbix anchor the graph relative to the current time. |
| `timeShift` | `string\|null` | `null` | Additional shift applied by `chart2.php` (mirrors the *time shift* field in the UI). Useful for comparing the same window against a different time frame. |

### Matching Zabbix 7.2 "From/To"

The MagicMirror configuration maps 1:1 to the controls shown on a Zabbix 7.2 graph page:

- `period` controls the overall width of the window—the same value Zabbix stores when you drag the **Period** slider or pick a preset (e.g., *Last 1 day*).
- `stime` is identical to the **From** input. You can provide a relative value such as `"now-24h"` or the exact timestamp that appears in the UI when you copy the graph URL.
- `timeShift` mirrors the optional *time shift* field. Leaving it `null` yields the default "current" graph, while values like `"1d"` instruct Zabbix to shift the window back by that amount.

Because each module instance keeps its own configuration you can run multiple `MMM-ZabbixGraphs` entries side-by-side—one showing the default 24-hour window, another locked to the past 7 days, and yet another shifted for week-over-week comparisons.

#### Example presets

- **Last 1 day (24h)** — The default `period: 24 * 60 * 60` matches the *Last 1 day* preset from the Zabbix 7.2 toolbar. No `stime` override is required because Zabbix automatically centers the window around "now".
- **Last 7 days (7d)** — Add `period: 7 * 24 * 60 * 60` to the module instance (again leaving `stime` empty) to mimic the *Last 7 days* preset from the UI.

### Finding the `graphId`

1. Open the graph in the Zabbix web UI.
2. Look at the browser address bar; the `graphid=<ID>` query parameter is the numeric value to place in the MagicMirror config.
3. Alternatively, open **Administration → API → Explore**, run `graph.get`, and copy the `graphid` from the response.

Once you have the numeric ID, copy it into the module configuration shown above. If you need to render multiple graphs on your mirror you can either:

- Add multiple `MMM-ZabbixGraphs` entries to `config.js`, each with its own `graphId`, dimensions, and `refreshMinutes`.
- Or duplicate an existing module block and adjust only the fields that change per graph (e.g., `graphId`, `width`, `height`).

Each module instance sends the configured `graphId`, `width`, `height`, and refresh interval to the helper which then calls `graph.get` and downloads the PNG matching that specific configuration.

### Using dashboard widgets instead of raw IDs

If you would rather reference an existing dashboard widget, set `dashboardId` and leave `graphId` empty. The helper queries `dashboard.get`, finds the requested widget, and reuses the graph configured inside it. Provide `widgetId` (from the dashboard editor URL) for an exact match or `widgetName` to select the first graph widget with a matching title. When neither is specified, the helper simply picks the first graph widget on the dashboard.

You can find the dashboard ID by opening the dashboard in the Zabbix UI and copying the `dashboardid=<ID>` query parameter from the address bar (`zabbix.php?action=dashboard.view&dashboardid=123`). Click **Edit** on the dashboard to expose widget URLs, then pick the graph widget you want and copy the `widgetid=<ID>` from the browser location bar while the widget editor is open.

If you are unsure which widget contains the right graph/time window, the Zabbix API Explorer can show you exactly what the dashboard stores:

1. Open **Administration → API → Explore** in the Zabbix UI.
2. Choose `dashboard.get` and set parameters like:
   ```json
   {
     "dashboardids": [123],
     "selectWidgets": ["widgetid", "name", "type", "fields"]
   }
   ```
3. Run the call; the `fields` array of each widget includes the graph binding (e.g., `graphid`) and any time overrides (such as `timeFrom`, `timeShift`, or a custom period) configured in the dashboard editor.

Armed with the `dashboardId`/`widgetId` and the field details above, you can point the module at dashboard-controlled graphs with confidence and know that the MagicMirror output mirrors the same source and time controls you configured in Zabbix.

### Authentication & Error Handling

- With an API token (validated on Zabbix 7.2 and available in earlier releases) in `config.apiToken`, the helper sends it via both `Authorization: Bearer <token>` and `X-Auth-Token` headers for every JSON-RPC call as well as the `chart2.php` PNG download, so a web session is never created or cached.
- Without `apiToken` the helper falls back to `user.login` using the configured `username`/`password`. The returned session token is cached per `zabbixUrl`/`username` and cleared automatically when Zabbix asks for a new login.
- API responses are validated for HTTP and JSON-RPC errors. Any issue is sent back to the front-end where it is rendered as an error message instead of an image.
- Every request (JSON-RPC and PNG downloads) inherits the configurable `requestTimeoutMs`. When Zabbix fails to respond in time the helper aborts both calls, clears any cached session token, and surfaces a friendly error so the UI can retry on the next refresh.
- Image downloads happen through the Zabbix frontend (`chart2.php`). The helper either sets the `auth=<session>` query parameter (password flow) or reuses the bearer headers described above (token flow).

### Creating an API Token

1. Sign in to the Zabbix web UI as an administrator and open **Administration → API → Tokens** (location validated on Zabbix 7.2).
2. Click **Create token**, pick the user the MagicMirror module should impersonate, and give the token a descriptive name.
3. (Optional) Set an expiration date that matches your rotation policy. You can leave it empty for a non-expiring token.
4. Click **Add** and copy the newly generated token string. This value is shown only once—store it safely.
5. Place the copied string into `config.apiToken`. Leave `username`/`password` blank (or remove them) to ensure the helper always uses the bearer token.

### Switching Between Token and Password Authentication

API tokens have been available since earlier Zabbix releases and are verified here against 7.2. If you prefer not to use a token (or are constrained by your deployment policy), keep `username`/`password` in the configuration. The helper caches the resulting session token and only sends the password to `user.login` when necessary. You can switch to `apiToken` later without changing any other fields.

### Debugging Tips

- Run MagicMirror with `npm start dev` to see console output. Any API errors logged by the helper will show up there.
- Ensure the user has permission to view the chosen `graphId`. A `Graph was not found` error usually indicates missing rights or a typo in the ID.

## How it Works

1. `MMM-ZabbixGraphs.js` schedules periodic refreshes and requests data from the helper.
2. `node_helper.js` authenticates through the JSON-RPC API.
3. `graph.get` and `graphitem.get` are used to validate access and surface metadata.
4. The PNG is downloaded via `chart2.php` and base64-encoded before being sent back to the browser.

For even more detail—including tests and development scripts—see the [`modules/MMM-ZabbixGraphs` README](modules/MMM-ZabbixGraphs/README.md).

## Development & Testing

You can verify the helper and front-end logic without launching a full MagicMirror² instance. The module ships with Jest tests
that exercise the authentication flow, graph metadata caching, dashboard widget resolution, and the PNG download safeguards.

```bash
cd modules/MMM-ZabbixGraphs
npm install
npm test
```

Running the suite prints the mocked Zabbix interactions and proves the helper can recover from expired sessions or widget
misconfigurations. When you are ready to validate the visual output, start MagicMirror in dev mode (`npm start dev` inside your
MagicMirror checkout) and watch the console for the same log messages described in the sections above.
