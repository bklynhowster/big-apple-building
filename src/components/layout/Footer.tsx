import { ExternalLink } from 'lucide-react';

export function Footer() {
  return (
    <footer className="bg-card border-t border-border py-6 mt-auto relative overflow-hidden">
      {/* Subtle architectural fragment in footer - roofline silhouette */}
      <svg
        className="absolute left-0 bottom-0 w-1/4 h-full pointer-events-none"
        style={{ opacity: 0.025 }}
        preserveAspectRatio="xMaxYMax slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="roofline-fragment" x="0" y="0" width="200" height="100" patternUnits="userSpaceOnUse">
            <path
              d="M0 60 L20 60 L20 50 L25 45 L30 50 L30 60 L60 60 L60 70 L80 70 L80 55 L85 50 L90 55 L90 70 L120 70 L120 60 L140 60 L140 45 L145 40 L150 45 L150 60 L180 60 L180 75 L200 75"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.4"
            />
            <line x1="20" y1="62" x2="60" y2="62" stroke="currentColor" strokeWidth="0.2" />
            <line x1="80" y1="72" x2="120" y2="72" stroke="currentColor" strokeWidth="0.2" />
            <line x1="140" y1="62" x2="180" y2="62" stroke="currentColor" strokeWidth="0.2" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#roofline-fragment)" className="text-foreground" />
      </svg>
      
      <div className="container mx-auto px-4 relative z-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-0.5 h-6 bg-primary rounded-full" />
            <div>
              <p className="text-sm font-medium text-foreground">
                ELK Solutions
              </p>
              <p className="text-xs text-muted-foreground">
                NYC Building Intelligence
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-6 text-xs text-muted-foreground">
            <a 
              href="https://opendata.cityofnewyork.us/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors flex items-center gap-1"
            >
              NYC Open Data
              <ExternalLink className="h-3 w-3" />
            </a>
            <a 
              href="https://www1.nyc.gov/site/buildings/index.page"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors flex items-center gap-1"
            >
              NYC DOB
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          
          <p className="text-xs text-muted-foreground">
            Data sourced from NYC Open Data
          </p>
        </div>
      </div>
    </footer>
  );
}
