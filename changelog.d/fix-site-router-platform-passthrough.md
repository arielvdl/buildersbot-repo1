### Fixed

- The site router no longer answers the Hub (`hub.`) and the RTX model endpoint (`llm-rtx.`) as published sites. They pass straight to their origin, so the wildcard route cannot take the model gateways offline again. More platform hosts go in `PASSTHROUGH_HOSTNAMES`.
