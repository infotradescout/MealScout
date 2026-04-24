import { useEffect } from "react";
import { useRoute, useLocation } from "wouter";

export default function AffiliateRedirect() {
  const [, setLocation] = useLocation();
  const [match, params] = useRoute("/ref/:tag");

  useEffect(() => {
    if (match && params?.tag) {
      // Redirect to home page with affiliate tag as query parameter
      setLocation(`/?ref=${encodeURIComponent(params.tag)}`);
    }
  }, [match, params, setLocation]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );
}
