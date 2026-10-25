<!-- shakefix:rid=r_20261011_8f3a2c -->
## 🩺 Patient intake

**Reporter note:** settle button does nothing
**Trigger:** shake · **Route:** `/bill/4/settle` · **App version:** `a1b2c3d` · **Device:** iPhone, 390×844

### Top console error
```
(none)
```

### Replay (also at `reports/r_20261011_8f3a2c/replay.json`)
```json
{
  "schema": "shakefix.replay/v1",
  "rid": "r_20261011_8f3a2c",
  "app": {
    "name": "splitpal",
    "version": "a1b2c3d",
    "baseUrl": "https://splitpal-xyz.run.app"
  },
  "device": {
    "ua": "Mozilla/5.0 (iPhone)",
    "viewport": [
      390,
      844
    ],
    "touch": true
  },
  "trigger": "shake",
  "note": "settle button does nothing",
  "startRoute": "/bill/new",
  "actions": [
    {
      "t": 0,
      "type": "input",
      "testid": "total-input",
      "selector": "[data-testid=\"total-input\"]",
      "value": "1000",
      "route": "/bill/new"
    },
    {
      "t": 900,
      "type": "click",
      "testid": "save-bill-btn",
      "selector": "[data-testid=\"save-bill-btn\"]",
      "route": "/bill/new"
    },
    {
      "t": 2100,
      "type": "click",
      "testid": "settle-btn",
      "selector": "[data-testid=\"settle-btn\"]",
      "route": "/bill/4"
    },
    {
      "t": 3300,
      "type": "click",
      "testid": "confirm-settle-btn",
      "selector": "[data-testid=\"confirm-settle-btn\"]",
      "route": "/bill/4/settle"
    }
  ],
  "expectation": {
    "testid": "settled-banner",
    "state": "visible"
  },
  "console": [],
  "network": [
    {
      "method": "POST",
      "path": "/api/bills/4/settle",
      "status": 409,
      "ms": 41
    }
  ]
}
```

---
_Filed automatically by ShakeFix intake. The ER team (Duo flow) will take it from here._
