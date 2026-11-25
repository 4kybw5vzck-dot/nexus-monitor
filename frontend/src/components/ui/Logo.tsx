import logoSvg from '../../assets/firmenlogo.svg?raw';

/**
 * Firmenlogo (J.Schneider Elektrotechnik). Liegt als SVG im Frontend, damit die
 * Oberfläche ohne Internet funktioniert. Die Farbe folgt der Textfarbe
 * (currentColor): weiß in der Seitenleiste, dunkelblau auf hellem Grund.
 */
export function CompanyLogo({ height = 26, className = '' }: { height?: number; className?: string }) {
  return (
    <span
      className={`company-logo ${className}`}
      style={{ height, width: (height * 344.08) / 46 }}
      // Statisches, mitgeliefertes SVG – keine Benutzereingabe
      dangerouslySetInnerHTML={{ __html: logoSvg }}
    />
  );
}
