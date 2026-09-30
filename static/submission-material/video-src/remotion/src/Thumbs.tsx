import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Background, Logo, FONT, C } from "./brand";

// 1280x720 YouTube thumbnails. Frame stills are extracted from the clips (public/thumb-*.png, untracked).
export const Thumb: React.FC<{ still: string; line1: string; line2: string; chip: string; chipColor: string }> = ({ still, line1, line2, chip, chipColor }) => (
  <AbsoluteFill style={{ fontFamily: FONT }}>
    <Background />
    <div style={{ position: "absolute", right: -40, top: 90, width: 700, height: 540, borderRadius: 18, overflow: "hidden", border: `6px solid ${chipColor}`, background: "#fff", boxShadow: "0 30px 70px -20px rgba(0,0,0,.9)" }}>
      <Img src={staticFile(still)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </div>
    <div style={{ position: "absolute", left: 56, top: 56, display: "flex", alignItems: "center", gap: 16 }}>
      <Logo size={72} />
      <span style={{ color: "#fff", fontWeight: 800, fontSize: 40, letterSpacing: -0.6 }}>Sentinel Vault</span>
    </div>
    <div style={{ position: "absolute", left: 56, top: 190, width: 560 }}>
      <div style={{ color: "#fff", fontWeight: 800, fontSize: 84, lineHeight: 1.0, letterSpacing: -2.5 }}>{line1}</div>
      <div style={{ color: C.cyan, fontWeight: 800, fontSize: 84, lineHeight: 1.0, letterSpacing: -2.5, marginTop: 8 }}>{line2}</div>
      <div style={{ marginTop: 34, display: "inline-block", background: chipColor, color: "#fff", fontWeight: 800, fontSize: 30, padding: "12px 24px", borderRadius: 12 }}>{chip}</div>
    </div>
  </AbsoluteFill>
);
