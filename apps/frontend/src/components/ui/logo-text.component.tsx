import React from 'react';

// ROC rebrand (see INTEGRATION_PLAN §"ROC customizations — branding layer").
// Kept as an inline SVG so the logo ships in the build without an HTTP fetch.
export const LogoTextComponent = () => {
  return (
    <svg
      width="180"
      height="36"
      viewBox="0 0 180 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="ROC Publisher"
    >
      <text x="0" y="26"
        fontFamily="Montserrat, system-ui, -apple-system, sans-serif"
        fontWeight="900"
        fontSize="26"
        letterSpacing="-0.5"
        fill="#FFB703">ROC</text>
      <text x="62" y="26"
        fontFamily="Montserrat, system-ui, -apple-system, sans-serif"
        fontWeight="700"
        fontSize="22"
        letterSpacing="0.5"
        fill="currentColor">· PUBLISHER</text>
    </svg>
  );
};
