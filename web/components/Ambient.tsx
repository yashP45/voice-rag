"use client";

/** Background field: green base, paper grain, drifting yellow dot grid, and
 *  three slow glows.
 *
 *  All of it sits behind z-0 and stays low-contrast so it never competes with
 *  the latency panel — the thing a judge actually reads. `active` brightens
 *  the field while a query is in flight: a status cue you feel rather than
 *  read. `prefers-reduced-motion` stops all of it in CSS.
 */
export function Ambient({ active = false }: { active?: boolean }) {
  return (
    <>
      <div className="field" aria-hidden />
      <div className="field-dots" aria-hidden />
      <div className="field-grain" aria-hidden />

      <div
        aria-hidden
        className="glow"
        style={{
          width: "46vw",
          height: "46vw",
          top: "-14vh",
          left: "-10vw",
          background: "radial-gradient(circle, var(--yellow) 0%, transparent 68%)",
          animation: "float-a 36s ease-in-out infinite",
          opacity: active ? 0.2 : 0.11,
          transition: "opacity 700ms ease",
        }}
      />
      <div
        aria-hidden
        className="glow"
        style={{
          width: "40vw",
          height: "40vw",
          bottom: "-16vh",
          right: "-8vw",
          background: "radial-gradient(circle, var(--pink) 0%, transparent 68%)",
          animation: "float-b 44s ease-in-out infinite",
          opacity: active ? 0.26 : 0.15,
          transition: "opacity 700ms ease",
        }}
      />
      <div
        aria-hidden
        className="glow"
        style={{
          width: "32vw",
          height: "32vw",
          top: "42%",
          right: "22%",
          background: "radial-gradient(circle, var(--green-lift) 0%, transparent 70%)",
          animation: "float-a 56s ease-in-out infinite reverse",
          opacity: 0.5,
        }}
      />
    </>
  );
}
