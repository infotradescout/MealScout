import { useEffect } from "react";
import { useRoute, useLocation } from "wouter";

export default function AffiliateRedirect() {
  const [, setLocation] = useLocation();
  const [match, params] = useRoute("/ref/:tag");

  useEffect(() => {
    if (match && params?.tag) {
      const tag = encodeURIComponent(params.tag);
      
      // Call backend to record the referral click and set cookies
      fetch(`/api/referral/ref/${tag}`, {
        method: "GET",
        credentials: "include", // Include cookies
      })
        .then(() => {
          // The backend records the click and sets referral cookies.
          setLocation("/");
        })
        .catch((error) => {
          console.error("Failed to record referral:", error);
          setLocation("/");
        });
    }
  }, [match, params, setLocation]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );
}
