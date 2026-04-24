import { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

export function BetaDisclaimer() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const hasSeenDisclaimer = localStorage.getItem("beta-disclaimer-seen");
    if (!hasSeenDisclaimer) {
      setOpen(true);
    }
  }, []);

  const handleClose = () => {
    localStorage.setItem("beta-disclaimer-seen", "true");
    setOpen(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      localStorage.setItem("beta-disclaimer-seen", "true");
    }
    setOpen(newOpen);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent data-testid="dialog-beta-disclaimer" className="max-w-lg">
        <AlertDialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-6 w-6 text-orange-500" />
            <AlertDialogTitle className="text-2xl">MealScout 2.0 Beta</AlertDialogTitle>
          </div>
          <AlertDialogDescription asChild>
            <div className="text-base space-y-3">
              <p className="text-foreground font-medium">
                Online Ordering infrastructure for local food operators.
              </p>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Operator-controlled menus, availability, offers, and order workflows for restaurants, bars, and food trucks.
                </p>
                <p className="text-sm text-muted-foreground">
                  Beta features are being rolled out in phases.
                </p>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button 
            onClick={handleClose} 
            className="w-full sm:w-auto"
            data-testid="button-beta-disclaimer-close"
          >
            Explore Beta
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

