import { Button } from '@/components/ui/button';

export const Header = () => {
  return (
    <header className="border-b bg-background">
      <nav className="container mx-auto flex items-center justify-between px-6 py-4">
        <span className="text-xl font-bold">EstateGrow</span>
        <Button className="bg-primary px-4 py-2 text-primary-foreground rounded-md">Contact us</Button>
      </nav>
    </header>
  );
};
