import { FileText, Shield, AlertTriangle, Hammer, Scale, FileSearch } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { SearchForm } from '@/components/search/SearchForm';

const features = [
  {
    icon: FileText,
    title: 'DOB Violations',
    description: 'Department of Buildings violations issued against properties.',
  },
  {
    icon: AlertTriangle,
    title: 'ECB Violations',
    description: 'OATH/ECB violation records including penalties and hearing dates.',
  },
  {
    icon: Shield,
    title: 'Safety Records',
    description: 'Safety-related violations classified by severity level.',
  },
  {
    icon: Hammer,
    title: 'Permits & Filings',
    description: 'Building permits, filings, and current status tracking.',
  },
];

export default function Index() {
  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      
      <main className="flex-1">
        {/* Hero Section - Architectural, restrained */}
        <section className="relative bg-primary py-14 md:py-20">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl mx-auto text-center mb-10">
              {/* Vertical accent lines - architectural motif */}
              <div className="flex justify-center items-center gap-3 mb-6">
                <div className="w-0.5 h-10 bg-primary-foreground/30 rounded-full" />
                <div className="flex flex-col items-center">
                  <div className="flex items-center gap-2 mb-1">
                    <Scale className="h-5 w-5 text-primary-foreground/70" />
                    <FileSearch className="h-5 w-5 text-primary-foreground/70" />
                  </div>
                </div>
                <div className="w-0.5 h-10 bg-primary-foreground/30 rounded-full" />
              </div>
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-semibold text-primary-foreground mb-3 tracking-tight">
                ELK Solutions
              </h1>
              <p className="text-xs uppercase tracking-municipal text-primary-foreground/60 mb-4">
                NYC Real Estate · Legal · Insurance Intelligence
              </p>
              <p className="text-base md:text-lg text-primary-foreground/80 max-w-xl mx-auto">
                Access Department of Buildings records, violations, and permits 
                using official NYC municipal data.
              </p>
            </div>
            
            <SearchForm />
          </div>
        </section>

        {/* Features Section */}
        <section className="py-14 bg-background">
          <div className="container mx-auto px-4">
            <div className="text-center mb-10">
              <p className="elk-case-header mb-2">Comprehensive Records</p>
              <h2 className="text-2xl md:text-3xl font-semibold text-foreground mb-3">
                Building Intelligence
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto text-sm">
                Access detailed information from NYC Open Data and the Department of Buildings 
                for due diligence, compliance, and legal research.
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              {features.map((feature) => (
                <div 
                  key={feature.title}
                  className="bg-card rounded-lg p-5 border border-border hover:shadow-sm transition-shadow"
                >
                  {/* Vertical accent rule */}
                  <div className="flex items-start gap-3">
                    <div className="w-0.5 h-full min-h-[60px] bg-primary/40 rounded-full flex-shrink-0" />
                    <div>
                      <div className="flex items-center justify-center w-9 h-9 bg-muted rounded mb-3">
                        <feature.icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <h3 className="text-sm font-semibold text-foreground mb-1.5">
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

        {/* Info Section */}
        <section className="py-10 border-t border-border">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl mx-auto">
              <div className="flex items-start gap-4">
                <div className="w-0.5 h-full min-h-[80px] bg-primary rounded-full flex-shrink-0" />
                <div>
                  <p className="elk-case-header mb-2">About</p>
                  <h3 className="text-base font-semibold text-foreground mb-2">
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
