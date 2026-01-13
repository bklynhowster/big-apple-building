import { ExternalLink } from 'lucide-react';

export function Footer() {
  return (
    <footer className="bg-card border-t border-border py-6 mt-auto">
      <div className="container mx-auto px-4">
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
