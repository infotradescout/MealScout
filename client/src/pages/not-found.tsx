import { Link } from "wouter";
import { AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[var(--bg-layered)] px-4 sm:px-6 py-12">
      <Card className="w-full max-w-md bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean-lg">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-3 items-center">
            <AlertCircle className="h-8 w-8 text-[color:var(--status-error)]" />
            <h1 className="text-2xl font-bold text-[color:var(--text-primary)]">
              404 Page Not Found
            </h1>
          </div>

          <p className="mt-4 text-sm text-[color:var(--text-secondary)]">
            That page does not exist or has moved. Check the URL or head back home.
          </p>

          <div className="mt-6 flex items-center gap-3">
            <Link href="/">
              <Button className="rounded-lg">Go Home</Button>
            </Link>
            <Link href="/contact">
              <Button variant="outline" className="rounded-lg">
                Contact Support
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}



