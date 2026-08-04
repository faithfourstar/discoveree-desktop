/**
 * The Discoveree "D" mark — inlined from the supplied single-colour asset
 * (client/public/brand/discoveree-d.svg) with the .cls fill converted to
 * currentColor so the rendering colour is a styling decision.
 *
 * Brand note: the mark's own teal is #0FA89F, which differs slightly from
 * the token accent #10B2A6 (--teal). The mark renders in its brand colour
 * on both chromes; tokens are unchanged pending a brand-alignment pass.
 */

export const BRAND_TEAL = "#0fa89f";

export function BrandMark({
  size = 26,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 532.6 512"
      width={size}
      height={size}
      fill="currentColor"
      role="img"
      aria-label="Discoveree"
      className={className}
    >
      <path d="M337.32,147.08a44.17,44.17,0,0,0-85.77.9c-19.47.27-39.53.67-56.66,1.21C58.7,153.46,25.28,222,25.28,222V58.26A30.25,30.25,0,0,1,55.53,28h223.8A227.22,227.22,0,0,1,438.77,93q4.11,4,8,8.22a16.69,16.69,0,0,1,4.56,11.92v.08C450.16,138.48,405.44,145.65,337.32,147.08Z" />
      <path d="M430,245.73c-33,21.59-83.1,35.19-163.66,43.14-6.11.63-12.07,1.22-17.83,1.88a44.19,44.19,0,0,0-83.57,12.62c-26.68,5.48-48.35,12-66.37,19.75-55.28,23.86-73.27,53.4-73.27,53.4V363.31c0-31.51,6.7-62.83,20.88-91,18.44-36.63,52.9-76.33,117-88.66a749.23,749.23,0,0,1,89.57-11.44,44.15,44.15,0,0,0,84.7-3.52c43.34-1.49,78.6-4.12,105.36-17.91,24.68-12.34,15.59-35.22,15-36.79,6.9,6.23,15.72,18.77,22,31.53a43.88,43.88,0,0,1,4.47,24l0,.17a75.88,75.88,0,0,1-3.42,15.36C474.62,203.57,460.14,226,430,245.73Z" />
      <path d="M507.32,256a227.93,227.93,0,0,1-228,228h-254S32.22,375.7,171.11,333.11a44.19,44.19,0,0,0,80.91-15c4.86-.47,9.72-1,14.54-1.72,73.15-10.27,229.32-31.74,219.6-156.37A226.66,226.66,0,0,1,507.32,256Z" />
    </svg>
  );
}
