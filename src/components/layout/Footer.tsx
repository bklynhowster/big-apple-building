import { ExternalLink } from 'lucide-react';
import nycArchitecturalLines from '@/assets/nyc-architectural-lines.png';

export function Footer() {
  return (
    <footer className="bg-card border-t border-border py-6 mt-auto relative overflow-hidden">
      {/* Subtle architectural fragment in footer */}
      <div 
        className="absolute left-0 bottom-0 w-1/4 h-full opacity-[0.025] pointer-events-none"
        style={{
          backgroundImage: `url(${nycArchitecturalLines})`,
          backgroundSize: 'cover',
          backgroundPosition: 'right bottom',
          filter: 'brightness(0.2)',
        }}
      />
      
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
