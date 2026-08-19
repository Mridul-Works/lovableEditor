import { useState } from "react";
import { ArrowRight, Zap, Shield, BarChart3, Star, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import heroImage from "@/assets/hero-dashboard.png";

const features = [
  {
    icon: Zap,
    title: "Lightning fast",
    description: "Sub-second page loads with globally distributed edge caching built in.",
  },
  {
    icon: Shield,
    title: "Bank-grade security",
    description: "SOC 2 Type II certified with end-to-end encryption on every request.",
  },
  {
    icon: BarChart3,
    title: "Real-time analytics",
    description: "Watch conversions happen live with dashboards that update every second.",
  },
];

const testimonials = [
  {
    quote: "TradeFlow cut our reporting time from days to minutes. The team can't imagine working without it.",
    name: "Sarah Chen",
    role: "Head of Operations, Meridian Capital",
    avatar: "https://i.pravatar.cc/100?img=5",
  },
  {
    quote: "The cleanest trading dashboard we've ever used. Onboarding took our analysts under an hour.",
    name: "Marcus Webb",
    role: "CTO, Northgate Partners",
    avatar: "https://i.pravatar.cc/100?img=12",
  },
];

const Index = () => {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <nav className="container mx-auto flex items-center justify-between px-6 py-4">
          <span className="text-xl font-bold tracking-tight">TradeFlow</span>
          <div className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground">Features</a>
            <a href="#testimonials" className="text-sm text-muted-foreground hover:text-foreground">Customers</a>
            <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground">Pricing</a>
            <Button onClick={() => setMenuOpen(!menuOpen)} className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium">
              Get started
            </Button>
          </div>
        </nav>
        {menuOpen && (
          <div className="border-t border-border p-4 md:hidden">
            <a href="#features" className="block py-2">Features</a>
          </div>
        )}
      </header>

      <section className="hero container mx-auto grid items-center gap-12 px-6 py-24 lg:grid-cols-2">
        <div>
          <span className="mb-4 inline-block rounded-full bg-secondary px-3 py-1 text-xs font-semibold uppercase tracking-wide text-secondary-foreground">
            New: v3 is here
          </span>
          <h1 className="text-5xl font-extrabold leading-tight tracking-tight">
            The trading desk your whole team will love
          </h1>
          <p className="mt-6 text-lg text-muted-foreground">
            TradeFlow unifies execution, risk and reporting in one beautiful
            workspace — so your desk moves faster with fewer mistakes.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Button className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-primary-foreground font-semibold">
              Start free trial
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button className="rounded-md border border-border px-6 py-3 font-semibold">
              Book a demo
            </Button>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">No credit card required · Free 14-day trial</p>
        </div>
        <img
          src={heroImage}
          alt="TradeFlow dashboard showing live positions and P&L"
          className="w-full rounded-xl border border-border shadow-2xl"
        />
      </section>

      <section id="features" className="features border-t border-border bg-secondary/30 py-24">
        <div className="container mx-auto px-6">
          <h2 className="text-center text-3xl font-bold">Everything a modern desk needs</h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
            Three pillars that make TradeFlow the fastest way to run your book.
          </p>
          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {features.map((feature) => (
              <Card key={feature.title} className="rounded-xl border border-border bg-card p-8">
                <CardContent className="p-0">
                  <feature.icon className="h-10 w-10 text-primary" />
                  <h3 className="mt-6 text-xl font-semibold">{feature.title}</h3>
                  <p className="mt-3 text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="testimonials" className="testimonials container mx-auto px-6 py-24">
        <h2 className="text-center text-3xl font-bold">Loved by trading teams everywhere</h2>
        <div className="mt-16 grid gap-8 md:grid-cols-2">
          {testimonials.map((item) => (
            <figure key={item.name} className="rounded-xl border border-border bg-card p-8">
              <div className="flex gap-1 text-primary">
                <Star className="h-4 w-4 fill-current" />
                <Star className="h-4 w-4 fill-current" />
                <Star className="h-4 w-4 fill-current" />
                <Star className="h-4 w-4 fill-current" />
                <Star className="h-4 w-4 fill-current" />
              </div>
              <blockquote className="mt-4 text-lg leading-relaxed">“{item.quote}”</blockquote>
              <figcaption className="mt-6 flex items-center gap-3">
                <img src={item.avatar} alt={item.name} className="h-10 w-10 rounded-full" />
                <div>
                  <div className="font-semibold">{item.name}</div>
                  <div className="text-sm text-muted-foreground">{item.role}</div>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="cta border-t border-border bg-primary py-20 text-primary-foreground">
        <div className="container mx-auto flex flex-col items-center px-6 text-center">
          <h2 className="text-3xl font-bold">Ready to move faster?</h2>
          <p className="mt-4 max-w-xl text-primary-foreground/80">
            Join 2,400+ teams already running their desk on TradeFlow.
          </p>
          <Button className="mt-8 inline-flex items-center gap-2 rounded-md bg-background px-8 py-3 font-semibold text-foreground">
            Start your free trial
            <Check className="h-4 w-4" />
          </Button>
        </div>
      </section>

      <footer className="footer border-t border-border py-12">
        <div className="container mx-auto flex flex-col items-center justify-between gap-4 px-6 md:flex-row">
          <span className="font-bold">TradeFlow</span>
          <p className="text-sm text-muted-foreground">© 2026 TradeFlow Inc. All rights reserved.</p>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <a href="/privacy" className="hover:text-foreground">Privacy</a>
            <a href="/terms" className="hover:text-foreground">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
