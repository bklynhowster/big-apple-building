export function Footer() {
  return (
    <footer className="bg-secondary text-secondary-foreground mt-auto">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm opacity-80">
            Data sourced from NYC Open Data and Department of Buildings
          </p>
          <div className="flex items-center gap-6">
            <a 
              href="https://opendata.cityofnewyork.us/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-sm opacity-80 hover:opacity-100 transition-opacity"
            >
              NYC Open Data
            </a>
            <a 
              href="https://www1.nyc.gov/site/buildings/index.page" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-sm opacity-80 hover:opacity-100 transition-opacity"
            >
              NYC DOB
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
