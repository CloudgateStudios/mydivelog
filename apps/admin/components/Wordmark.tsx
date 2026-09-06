/**
 * The mark and the wordmark.
 *
 * The mark is the letter M drawn as a dive profile — an M is one descent and
 * one ascent, which is a dive — hanging below a surface rule, with the deepest
 * point marked the way the app marks it on every profile it draws.
 *
 * SVG rather than an image file: it is a few hundred bytes, it stays sharp at
 * any size, and it takes its colour from the same tokens as everything else,
 * so it follows the theme without a second asset.
 */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      className="mark"
    >
      {/*
        The surface, drawn short of the M's width so it reads as a waterline
        rather than as a lid on a box.
       */}
      <path
        d="M12 12 H52"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
        opacity="0.55"
      />
      <polyline
        points="14,53 14,25 32,47 50,25 50,53"
        fill="none"
        stroke="currentColor"
        strokeWidth="5.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/*
        Wider than the stroke it sits on, or it disappears into the vertex at
        the sizes this is actually seen at.
       */}
      <circle cx="32" cy="47" r="6" className="mark-dot" />
    </svg>
  );
}

/**
 * The mark and the name, with the staff badge.
 *
 * "My" sits back a weight so the eye lands on "DiveLog" — the half people
 * actually say. It is one word to a screen reader either way, which is why the
 * split is presentational and not two elements.
 *
 * The badge is not decoration. This panel shows other people's dives, and
 * anyone glancing at a screenshot should be able to tell instantly which side
 * of the login it came from.
 */
export function Wordmark({ href = '/', size = 20 }: { href?: string; size?: number }) {
  return (
    <a className="wordmark" href={href}>
      <Mark size={size} />
      <span className="wordmark-text">
        <span className="wordmark-my">My</span>DiveLog
      </span>
      <span className="wordmark-staff">Staff</span>
    </a>
  );
}
