import { FileText, Shield, AlertTriangle, Hammer, Scale, FileSearch } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { SearchForm } from '@/components/search/SearchForm';
import brooklynBridgeLines from '@/assets/brooklyn-bridge-lines.png';

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
        {/* Hero Section - Architectural, with Brooklyn Bridge line art background */}
        <section className="relative bg-primary py-16 md:py-24 overflow-hidden">
          {/* Brooklyn Bridge Line Art Background */}
          <div 
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `url(${brooklynBridgeLines})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              opacity: 0.08,
              filter: 'brightness(1.5) contrast(0.8)',
              mixBlendMode: 'soft-light',
            }}
          />
          
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
              <p className="elk-case-header mb-3">Record Categories</p>
              <h2 className="text-2xl md:text-3xl text-foreground mb-4">
                Municipal Enforcement Records
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto text-sm leading-relaxed">
                Consolidated building enforcement data from the New York City Department of Buildings 
                and OATH/ECB, structured for legal review, underwriting, and regulatory compliance assessment.
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
                  <p className="elk-case-header mb-3">Platform Overview</p>
                  <h3 className="font-serif text-lg font-bold text-foreground mb-3 tracking-tight">
                    NYC Building Enforcement Intelligence
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    ELK Solutions aggregates and structures official enforcement records from the 
                    New York City Department of Buildings, OATH/ECB, and related municipal agencies. 
                    The platform serves attorneys conducting litigation research, insurers evaluating 
                    property risk exposure, compliance officers reviewing regulatory status, and 
                    transaction professionals performing acquisition due diligence. All records are 
                    sourced from NYC Open Data and official city databases.
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
