/**
 * The banner on the legal pages.
 *
 * These pages describe what the software actually does, which is the useful
 * half of a privacy policy and terms of service. They have not been through a
 * lawyer, and saying so is more honest than a page that looks reviewed because
 * it is written in the right register.
 */
export function LegalNotice() {
  return (
    <p className="notice legal-notice" role="note">
      <strong>Plain English, not yet lawyer-reviewed.</strong> MyDiveLog has not launched. This page
      describes what the software does today and what we intend, and it will be replaced by a
      reviewed version before anyone is charged for anything. Where it is vague, assume the cautious
      reading.
    </p>
  );
}
