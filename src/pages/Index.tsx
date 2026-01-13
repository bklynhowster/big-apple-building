import { FileText, Shield, AlertTriangle, Hammer, Scale, FileSearch } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { SearchForm } from '@/components/search/SearchForm';

// Inline SVG component for NYC architectural line art background
const NYCArchitecturalBackground = () => (
  <svg
    className="absolute inset-0 w-full h-full pointer-events-none"
    style={{ opacity: 0.04 }}
    preserveAspectRatio="xMidYMid slice"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <pattern id="nyc-lines" x="0" y="0" width="400" height="300" patternUnits="userSpaceOnUse">
        {/* Brooklyn Bridge cable geometry */}
        <path
          d="M0 280 Q100 200 200 280 Q300 200 400 280"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.5"
        />
        <path
          d="M0 260 Q100 180 200 260 Q300 180 400 260"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.3"
        />
        {/* Suspension cables - vertical lines from main cable */}
        <line x1="50" y1="240" x2="50" y2="280" stroke="currentColor" strokeWidth="0.3" />
        <line x1="100" y1="210" x2="100" y2="280" stroke="currentColor" strokeWidth="0.3" />
        <line x1="150" y1="230" x2="150" y2="280" stroke="currentColor" strokeWidth="0.3" />
        <line x1="200" y1="250" x2="200" y2="280" stroke="currentColor" strokeWidth="0.3" />
        <line x1="250" y1="230" x2="250" y2="280" stroke="currentColor" strokeWidth="0.3" />
        <line x1="300" y1="210" x2="300" y2="280" stroke="currentColor" strokeWidth="0.3" />
        <line x1="350" y1="240" x2="350" y2="280" stroke="currentColor" strokeWidth="0.3" />
        
        {/* Brownstone roofline silhouettes */}
        <path
          d="M0 120 L0 100 L20 100 L20 90 L25 85 L30 90 L30 100 L60 100 L60 110 L80 110 L80 95 L85 90 L90 95 L90 110 L120 110 L120 100"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.4"
        />
        <path
          d="M120 100 L140 100 L140 85 L145 80 L150 85 L150 100 L180 100 L180 115 L200 115 L200 105 L220 105 L220 90 L225 85 L230 90 L230 105 L260 105"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.4"
        />
        <path
          d="M260 105 L280 105 L280 95 L300 95 L300 110 L320 110 L320 100 L325 95 L330 100 L330 110 L360 110 L360 100 L380 100 L380 115 L400 115"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.4"
        />
        
        {/* Cornice details - horizontal accent lines */}
        <line x1="20" y1="102" x2="60" y2="102" stroke="currentColor" strokeWidth="0.2" />
        <line x1="80" y1="112" x2="120" y2="112" stroke="currentColor" strokeWidth="0.2" />
        <line x1="140" y1="102" x2="180" y2="102" stroke="currentColor" strokeWidth="0.2" />
        <line x1="220" y1="107" x2="260" y2="107" stroke="currentColor" strokeWidth="0.2" />
        <line x1="300" y1="112" x2="360" y2="112" stroke="currentColor" strokeWidth="0.2" />
        
        {/* Stoop/entrance hints */}
        <path d="M45 100 L45 120 L55 120 L55 100" fill="none" stroke="currentColor" strokeWidth="0.3" />
        <path d="M165 100 L165 120 L175 120 L175 100" fill="none" stroke="currentColor" strokeWidth="0.3" />
        <path d="M345 100 L345 120 L355 120 L355 100" fill="none" stroke="currentColor" strokeWidth="0.3" />
        
        {/* Manhattan skyline suggestion - distant towers */}
        <line x1="70" y1="60" x2="70" y2="100" stroke="currentColor" strokeWidth="0.2" />
        <line x1="72" y1="65" x2="72" y2="100" stroke="currentColor" strokeWidth="0.2" />
        <line x1="190" y1="50" x2="190" y2="100" stroke="currentColor" strokeWidth="0.2" />
        <line x1="192" y1="55" x2="192" y2="100" stroke="currentColor" strokeWidth="0.2" />
        <line x1="194" y1="60" x2="194" y2="100" stroke="currentColor" strokeWidth="0.2" />
        <line x1="310" y1="55" x2="310" y2="95" stroke="currentColor" strokeWidth="0.2" />
        <line x1="312" y1="60" x2="312" y2="95" stroke="currentColor" strokeWidth="0.2" />
        
        {/* Bridge tower hints */}
        <rect x="95" y="160" width="10" height="100" fill="none" stroke="currentColor" strokeWidth="0.3" />
        <rect x="295" y="160" width="10" height="100" fill="none" stroke="currentColor" strokeWidth="0.3" />
        <path d="M95 160 L100 150 L105 160" fill="none" stroke="currentColor" strokeWidth="0.3" />
        <path d="M295 160 L300 150 L305 160" fill="none" stroke="currentColor" strokeWidth="0.3" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#nyc-lines)" className="text-primary-foreground" />
  </svg>
);

const features = [
  {
    icon: FileText,
    title: 'DOB Violations',
    description: 'Active and resolved violation history. Verify compliance status and outstanding enforcement actions.',
  },
  {
    icon: AlertTriangle,
    title: 'ECB Violations',
    description: 'OATH/ECB penalty records, hearing outcomes, and outstanding civil liabilities.',
  },
  {
    icon: Shield,
    title: 'Safety Classifications',
    description: 'Hazardous and immediately hazardous designations. Identify elevated risk exposure.',
  },
  {
    icon: Hammer,
    title: 'Permits & Filings',
    description: 'Filed applications, issued permits, and work authorization status.',
  },
];

export default function Index() {
  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      
      <main className="flex-1">
        {/* Hero Section - Architectural, with NYC line art background */}
        <section className="relative bg-primary py-16 md:py-24 overflow-hidden">
          {/* NYC Architectural Line Art Background */}
          <NYCArchitecturalBackground />
          
          <div className="container mx-auto px-4 relative z-10">
            <div className="max-w-3xl mx-auto text-center mb-12">
              {/* Vertical accent lines - architectural motif */}
              <div className="flex justify-center items-center gap-3 mb-8">
                <div className="w-px h-12 bg-primary-foreground/20" />
                <div className="flex flex-col items-center">
                  <div className="flex items-center gap-2 mb-1">
                    <Scale className="h-5 w-5 text-primary-foreground/60" />
                    <FileSearch className="h-5 w-5 text-primary-foreground/60" />
                  </div>
                </div>
                <div className="w-px h-12 bg-primary-foreground/20" />
              </div>
              <h1 className="text-4xl md:text-5xl lg:text-6xl text-primary-foreground mb-4">
                New York City Property Intelligence
              </h1>
              <p className="elk-case-header text-primary-foreground/50 mb-6">
                Due Diligence · Compliance · Official Records
              </p>
              <p className="text-base md:text-lg text-primary-foreground/75 max-w-xl mx-auto font-sans">
                Comprehensive access to Department of Buildings violations, permits, and enforcement records for real estate transactions, litigation support, and regulatory compliance.
              </p>
            </div>
            
            <SearchForm />
          </div>
        </section>

        {/* Features Section */}
        <section className="py-16 md:py-20 bg-background">
          <div className="container mx-auto px-4">
            <div className="text-center mb-12">
              <p className="elk-case-header mb-3">Comprehensive Records</p>
              <h2 className="text-2xl md:text-3xl text-foreground mb-4">
                Building Intelligence
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto text-sm leading-relaxed">
                Access detailed information from NYC Open Data and the Department of Buildings 
                for due diligence, compliance, and legal research.
              </p>
            </div>
            
            {/* Horizontal rule divider */}
            <div className="max-w-4xl mx-auto border-t border-border mb-12" />
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
              {features.map((feature) => (
                <div 
                  key={feature.title}
                  className="elk-flat-card p-5"
                >
                  {/* Vertical accent rule */}
                  <div className="flex items-start gap-4">
                    <div className="w-0.5 h-full min-h-[70px] bg-primary/30 flex-shrink-0" />
                    <div>
                      <div className="flex items-center justify-center w-8 h-8 bg-muted/80 rounded-sm mb-3">
                        <feature.icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <h3 className="text-sm font-semibold text-foreground mb-2 tracking-tight">
                        {feature.title}
                      </h3>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {feature.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Info Section with subtle architectural fragment */}
        <section className="py-12 md:py-16 border-t border-border relative overflow-hidden">
          {/* Subtle architectural fragment - bridge cable lines */}
          <svg
            className="absolute right-0 top-0 w-1/3 h-full pointer-events-none"
            style={{ opacity: 0.03 }}
            preserveAspectRatio="xMinYMid slice"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <pattern id="cable-fragment" x="0" y="0" width="200" height="150" patternUnits="userSpaceOnUse">
                <path d="M0 120 Q50 60 100 120 Q150 60 200 120" fill="none" stroke="currentColor" strokeWidth="0.5" />
                <path d="M0 100 Q50 40 100 100 Q150 40 200 100" fill="none" stroke="currentColor" strokeWidth="0.3" />
                <line x1="25" y1="90" x2="25" y2="120" stroke="currentColor" strokeWidth="0.3" />
                <line x1="50" y1="70" x2="50" y2="120" stroke="currentColor" strokeWidth="0.3" />
                <line x1="75" y1="90" x2="75" y2="120" stroke="currentColor" strokeWidth="0.3" />
                <line x1="125" y1="90" x2="125" y2="120" stroke="currentColor" strokeWidth="0.3" />
                <line x1="150" y1="70" x2="150" y2="120" stroke="currentColor" strokeWidth="0.3" />
                <line x1="175" y1="90" x2="175" y2="120" stroke="currentColor" strokeWidth="0.3" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#cable-fragment)" className="text-foreground" />
          </svg>
          
          <div className="container mx-auto px-4 relative z-10">
            <div className="max-w-3xl mx-auto">
              <div className="flex items-start gap-5">
                <div className="w-0.5 h-full min-h-[100px] bg-primary flex-shrink-0" />
                <div>
                  <p className="elk-case-header mb-3">About</p>
                  <h3 className="font-serif text-lg font-bold text-foreground mb-3 tracking-tight">
                    Professional Building Records Access
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    ELK Solutions provides access to publicly available building records from 
                    the New York City Department of Buildings and NYC Open Data. Designed for 
                    attorneys, insurers, architects, inspectors, and property professionals 
                    who require efficient access to violation and permit histories.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
      
      <Footer />
    </div>
  );
}
