import { Building2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SavedSearchesDropdown } from '@/components/SavedSearchesDropdown';

export function Header() {
  return (
    <header className="bg-card border-b border-border shadow-sm">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="flex items-center justify-center w-10 h-10 bg-primary rounded-md">
              <Building2 className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground tracking-tight">
                NYC Building Intel
              </h1>
              <p className="text-xs text-muted-foreground">
                Department of Buildings Records
              </p>
            </div>
          </Link>
          <nav className="flex items-center gap-4">
            <SavedSearchesDropdown />
            <Link 
              to="/" 
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden md:inline"
            >
              Search
            </Link>
            <a 
              href="https://www1.nyc.gov/site/buildings/index.page" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden md:inline"
            >
              NYC DOB
            </a>
          </nav>
        </div>
      </div>
    </header>
  );
}
