/**
 * BusinessProfileImport — Portable React component for importing
 * business profile data from Google Places and Facebook Pages.
 *
 * Usage:
 *   <BusinessProfileImport
 *     entityType="restaurant"
 *     entityId="abc123"
 *     entityName="Taco Truck"
 *     entityAddress="123 Main St"
 *     entityCity="Austin"
 *     entityState="TX"
 *     onImportComplete={(result) => { refetch(); }}
 *   />
 */

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Globe,
  Facebook,
  Search,
  CheckCircle2,
  XCircle,
  Loader2,
  Image as ImageIcon,
  MapPin,
  Star,
  Clock,
  Phone,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from "lucide-react";

type ImportProvider = "google" | "facebook";

type ImportResult = {
  provider: ImportProvider;
  success: boolean;
  fieldsUpdated?: number;
  photosImported?: number;
  error?: string;
};

type FacebookPage = {
  pageId: string;
  pageName: string;
  accessToken: string;
};

interface BusinessProfileImportProps {
  entityType: "restaurant" | "host";
  entityId: string;
  entityName: string;
  entityAddress?: string;
  entityCity?: string;
  entityState?: string;
  onImportComplete?: (result: ImportResult) => void;
  /** If true, shows a compact inline version */
  compact?: boolean;
}

export default function BusinessProfileImport({
  entityType,
  entityId,
  entityName,
  entityAddress,
  entityCity,
  entityState,
  onImportComplete,
  compact = false,
}: BusinessProfileImportProps) {
  const { toast } = useToast();

  // Google state
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleResult, setGoogleResult] = useState<ImportResult | null>(null);

  // Facebook state
  const [fbLoading, setFbLoading] = useState(false);
  const [fbPages, setFbPages] = useState<FacebookPage[]>([]);
  const [fbSelectedPage, setFbSelectedPage] = useState<FacebookPage | null>(null);
  const [fbResult, setFbResult] = useState<ImportResult | null>(null);
  const [fbUrlInput, setFbUrlInput] = useState("");
  const [showFbSection, setShowFbSection] = useState(false);

  // Expanded details
  const [showDetails, setShowDetails] = useState(false);

  // ── Google Import ──────────────────────────────────────────────────────

  const handleGoogleImport = useCallback(async () => {
    setGoogleLoading(true);
    setGoogleResult(null);

    try {
      const res = await apiRequest(
        "POST",
        `/api/profiles/${entityType}/${entityId}/populate`,
      );
      const data = await res.json();

      if (data.success) {
        const result: ImportResult = {
          provider: "google",
          success: true,
          fieldsUpdated: data.fieldsUpdated || 0,
          photosImported: data.photosImported || 0,
        };
        setGoogleResult(result);
        onImportComplete?.(result);
        toast({
          title: "Google import complete",
          description: `Profile updated with data from Google Places`,
        });
      } else {
        const result: ImportResult = {
          provider: "google",
          success: false,
          error: data.error || "Import failed",
        };
        setGoogleResult(result);
        toast({
          title: "Google import issue",
          description: data.error || "Could not find matching business on Google",
          variant: "destructive",
        });
      }
    } catch (err) {
      const result: ImportResult = {
        provider: "google",
        success: false,
        error: "Network error",
      };
      setGoogleResult(result);
      toast({
        title: "Import failed",
        description: "Network error. Please try again.",
        variant: "destructive",
      });
    } finally {
      setGoogleLoading(false);
    }
  }, [entityType, entityId, onImportComplete, toast]);

  // ── Facebook Import ────────────────────────────────────────────────────

  const handleFacebookConnect = useCallback(async () => {
    // For now, we'll use the existing Facebook auth flow.
    // The user's Facebook access token should be available from their auth session.
    // This triggers a redirect to Facebook OAuth with pages_show_list scope.
    const redirectUri = `${window.location.origin}/api/auth/facebook/callback`;
    const scope = "pages_show_list,pages_read_engagement,pages_read_user_content";
    const fbAppId = (window as any).__FB_APP_ID || "";

    if (!fbAppId) {
      toast({
        title: "Facebook not configured",
        description: "Facebook integration is being set up. Check back soon!",
        variant: "destructive",
      });
      return;
    }

    // Open Facebook OAuth in a popup
    const width = 600;
    const height = 700;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;
    const oauthUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${fbAppId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_type=code&state=profile_import_${entityType}_${entityId}`;

    window.open(
      oauthUrl,
      "facebook_import",
      `width=${width},height=${height},left=${left},top=${top}`,
    );

    toast({
      title: "Connecting to Facebook",
      description: "Complete the authorization in the popup window",
    });
  }, [entityType, entityId, toast]);

  const handleFacebookImport = useCallback(
    async (page: FacebookPage) => {
      setFbLoading(true);
      setFbResult(null);

      try {
        const res = await apiRequest(
          "POST",
          `/api/profiles/${entityType}/${entityId}/populate-facebook`,
          {
            pageId: page.pageId,
            pageAccessToken: page.accessToken,
          },
        );
        const data = await res.json();

        if (data.success) {
          const result: ImportResult = {
            provider: "facebook",
            success: true,
            fieldsUpdated: data.fieldsUpdated || 0,
            photosImported: data.photosImported || 0,
          };
          setFbResult(result);
          onImportComplete?.(result);
          toast({
            title: "Facebook import complete",
            description: `Imported ${data.photosImported || 0} photos and updated profile`,
          });
        } else {
          const result: ImportResult = {
            provider: "facebook",
            success: false,
            error: data.error || "Import failed",
          };
          setFbResult(result);
          toast({
            title: "Facebook import issue",
            description: data.error || "Could not import from Facebook",
            variant: "destructive",
          });
        }
      } catch (err) {
        const result: ImportResult = {
          provider: "facebook",
          success: false,
          error: "Network error",
        };
        setFbResult(result);
      } finally {
        setFbLoading(false);
      }
    },
    [entityType, entityId, onImportComplete, toast],
  );

  // ── Render: Compact version ────────────────────────────────────────────

  if (compact) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleGoogleImport}
          disabled={googleLoading}
          className="gap-1.5"
        >
          {googleLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : googleResult?.success ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Globe className="h-3.5 w-3.5" />
          )}
          Import from Google
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleFacebookConnect}
          disabled={fbLoading}
          className="gap-1.5"
        >
          {fbLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : fbResult?.success ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Facebook className="h-3.5 w-3.5" />
          )}
          Import from Facebook
        </Button>
      </div>
    );
  }

  // ── Render: Full card version ──────────────────────────────────────────

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-amber-500" />
          <CardTitle className="text-lg">Quick Profile Setup</CardTitle>
        </div>
        <CardDescription>
          Import your business info from Google or Facebook in one click.
          We'll fill in your description, hours, photos, and more — you can
          always edit anything afterward.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Google Import */}
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50">
                <Globe className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="font-medium text-sm">Google Places</p>
                <p className="text-xs text-muted-foreground">
                  Hours, photos, reviews, description, and more
                </p>
              </div>
            </div>
            <Button
              onClick={handleGoogleImport}
              disabled={googleLoading}
              size="sm"
              className="gap-1.5"
            >
              {googleLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Importing...
                </>
              ) : googleResult?.success ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Imported
                </>
              ) : (
                <>
                  <Search className="h-3.5 w-3.5" />
                  Auto-Fill from Google
                </>
              )}
            </Button>
          </div>

          {googleResult && (
            <div
              className={`text-xs rounded-md p-2 ${
                googleResult.success
                  ? "bg-green-50 text-green-700"
                  : "bg-red-50 text-red-700"
              }`}
            >
              {googleResult.success ? (
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Profile updated with Google data
                  {googleResult.photosImported
                    ? ` • ${googleResult.photosImported} photos imported`
                    : ""}
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <XCircle className="h-3.5 w-3.5" />
                  {googleResult.error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Facebook Import */}
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50">
                <Facebook className="h-4 w-4 text-blue-700" />
              </div>
              <div>
                <p className="font-medium text-sm">Facebook Page</p>
                <p className="text-xs text-muted-foreground">
                  About, cover photo, gallery, hours, and reviews
                </p>
              </div>
            </div>
            <Button
              onClick={() => setShowFbSection(!showFbSection)}
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              {fbResult?.success ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  Imported
                </>
              ) : (
                <>
                  <Facebook className="h-3.5 w-3.5" />
                  Connect Facebook
                  {showFbSection ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </>
              )}
            </Button>
          </div>

          {showFbSection && (
            <div className="space-y-3 pt-2">
              <p className="text-xs text-muted-foreground">
                Connect your Facebook account to import data from your business page.
                We'll pull in your about section, cover photo, gallery photos, hours, and reviews.
              </p>
              <Button
                onClick={handleFacebookConnect}
                disabled={fbLoading}
                variant="default"
                size="sm"
                className="gap-1.5 bg-[#1877F2] hover:bg-[#166FE5]"
              >
                {fbLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Facebook className="h-3.5 w-3.5" />
                )}
                Continue with Facebook
              </Button>

              {fbPages.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs">Select your business page:</Label>
                  {fbPages.map((page) => (
                    <button
                      key={page.pageId}
                      onClick={() => {
                        setFbSelectedPage(page);
                        handleFacebookImport(page);
                      }}
                      className={`w-full text-left rounded-md border p-2.5 text-sm transition-colors hover:bg-accent ${
                        fbSelectedPage?.pageId === page.pageId
                          ? "border-primary bg-accent"
                          : ""
                      }`}
                    >
                      {page.pageName}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {fbResult && (
            <div
              className={`text-xs rounded-md p-2 ${
                fbResult.success
                  ? "bg-green-50 text-green-700"
                  : "bg-red-50 text-red-700"
              }`}
            >
              {fbResult.success ? (
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Profile updated with Facebook data
                  {fbResult.photosImported
                    ? ` • ${fbResult.photosImported} photos imported`
                    : ""}
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <XCircle className="h-3.5 w-3.5" />
                  {fbResult.error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Summary */}
        {(googleResult?.success || fbResult?.success) && (
          <>
            <Separator />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span>
                Profile data imported successfully. Review and edit your profile
                below.
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
