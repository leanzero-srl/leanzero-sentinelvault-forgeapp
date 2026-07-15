import React, { useState, useEffect } from "react";
import { invoke } from "@forge/bridge";
import { shouldShowLicenseBanner } from "./license.js";

// Non-blocking "unlicensed" nag banner for the admin surfaces. Calls check-license once; renders
// nothing unless the app is explicitly unlicensed (see shouldShowLicenseBanner — fail-open in dev).
// It NEVER gates functionality: sealed content stays protected regardless. Atlassian's Marketplace
// billing enforces payment; this is just the graceful in-app signal to renew.
const LicenseBanner = () => {
  const [result, setResult] = useState(null);

  useEffect(() => {
    let alive = true;
    invoke("check-license")
      .then((r) => { if (alive) setResult(r); })
      .catch(() => { /* fail-open: on any error, show nothing */ });
    return () => { alive = false; };
  }, []);

  if (!shouldShowLicenseBanner(result)) return null;

  return (
    <div className="license-banner" role="status">
      <span className="license-banner-text">
        Sentinel Vault is unlicensed. Your sealed content stays protected — please renew your
        subscription in the Atlassian Marketplace to keep using the app.
      </span>
    </div>
  );
};

export default LicenseBanner;
