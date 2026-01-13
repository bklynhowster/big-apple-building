import { Link, useLocation } from 'react-router-dom';
import { Search } from 'lucide-react';
import { SavedSearchesDropdown } from '@/components/SavedSearchesDropdown';
import { Button } from '@/components/ui/button';

export function Header() {
  const location = useLocation();
  const isResultsPage = location.pathname === '/results';

  return (
    <header className="bg-card border-b border-border">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            {/* Vertical accent rule - architectural motif */}
            <div className="w-1 h-8 bg-primary rounded-full" />
            <div>
              <h1 className="text-lg font-semibold text-foreground tracking-tight">
                ELK Solutions
              </h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-municipal">
                Real Estate & Legal Intelligence
              </p>
            </div>
          </Link>
          <nav className="flex items-center gap-4">
            <SavedSearchesDropdown />
            {isResultsPage ? (
              <Link to="/">
                <Button variant="outline" size="sm" className="gap-2">
                  <Search className="h-4 w-4" />
                  <span className="hidden sm:inline">New Search</span>
                </Button>
              </Link>
            ) : (
              <Link 
                to="/" 
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden md:inline"
              >
                Search
              </Link>
            )}
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
