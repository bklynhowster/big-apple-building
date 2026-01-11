import { Building2, FileText, Shield, AlertTriangle, Hammer } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { SearchForm } from '@/components/search/SearchForm';

const features = [
  {
    icon: FileText,
    title: 'DOB Violations',
    description: 'View all Department of Buildings violations issued against a property.',
  },
  {
    icon: AlertTriangle,
    title: 'ECB Violations',
    description: 'Access OATH/ECB violation records including penalties and hearing dates.',
  },
  {
    icon: Shield,
    title: 'Safety Violations',
    description: 'Review safety-related violations classified by severity.',
  },
  {
    icon: Hammer,
    title: 'Permits',
    description: 'Track building permits, filings, and their current status.',
  },
];

export default function Index() {
  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      
      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative bg-primary py-16 md:py-24">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl mx-auto text-center mb-10">
              <div className="flex justify-center mb-6">
                <div className="flex items-center justify-center w-16 h-16 bg-primary-foreground/10 rounded-xl">
                  <Building2 className="h-8 w-8 text-primary-foreground" />
                </div>
              </div>
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-primary-foreground mb-4 tracking-tight">
                NYC Building Intel
              </h1>
              <p className="text-lg md:text-xl text-primary-foreground/80">
                Search New York City properties and access Department of Buildings records, 
                violations, and permits using official NYC data.
              </p>
            </div>
            
            <SearchForm />
          </div>
        </section>

        {/* Features Section */}
        <section className="py-16 bg-background">
          <div className="container mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4">
                Comprehensive Building Records
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Access detailed information from NYC Open Data and the Department of Buildings 
                to support your research, due diligence, and compliance needs.
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {features.map((feature) => (
                <div 
                  key={feature.title}
                  className="bg-card rounded-lg p-6 border border-border hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center justify-center w-12 h-12 bg-accent rounded-lg mb-4">
                    <feature.icon className="h-6 w-6 text-accent-foreground" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Info Section */}
        <section className="py-12 bg-muted/50">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl mx-auto text-center">
              <h3 className="text-lg font-semibold text-foreground mb-3">
                About This Tool
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                NYC Building Intel provides access to publicly available building records from 
                the New York City Department of Buildings and NYC Open Data. This tool is 
                designed for preservationists, attorneys, architects, inspectors, and property 
                managers who need quick access to violation and permit histories.
              </p>
            </div>
          </div>
        </section>
      </main>
      
      <Footer />
    </div>
  );
}
