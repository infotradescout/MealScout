/**
 * BusinessPhotoGallery — Gallery management component for business photos.
 * Supports viewing, uploading, reordering, and deleting photos.
 * Shows photos from manual uploads, Google, and Facebook imports.
 */

import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Upload,
  Trash2,
  Star,
  Image as ImageIcon,
  GripVertical,
  Plus,
  Loader2,
  X,
  Camera,
  Facebook,
  Globe,
} from "lucide-react";

type GalleryPhoto = {
  id: string;
  url: string;
  thumbnailUrl?: string;
  caption?: string;
  source: string;
  sourceProvider?: string;
  isFeatured: boolean;
  sortOrder: number;
  width?: number;
  height?: number;
};

type GooglePhoto = {
  url: string;
  width: number;
  height: number;
  source: "google";
  attribution?: string;
};

interface BusinessPhotoGalleryProps {
  entityType: "restaurant" | "host";
  entityId: string;
  /** Max photos allowed. Default: 50 */
  maxPhotos?: number;
  /** Whether the current user can edit (upload/delete) */
  canEdit?: boolean;
  /** Compact mode for inline display */
  compact?: boolean;
}

export default function BusinessPhotoGallery({
  entityType,
  entityId,
  maxPhotos = 50,
  canEdit = true,
  compact = false,
}: BusinessPhotoGalleryProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

  // Fetch gallery photos
  const { data, isLoading } = useQuery({
    queryKey: ["business-photos", entityType, entityId],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/profiles/${entityType}/${entityId}/photos`,
      );
      return res.json() as Promise<{
        gallery: GalleryPhoto[];
        googlePhotos: GooglePhoto[];
      }>;
    },
    enabled: !!entityId,
  });

  const gallery = data?.gallery || [];
  const googlePhotos = data?.googlePhotos || [];
  const totalPhotos = gallery.length;

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      // First upload to the media endpoint
      const formData = new FormData();
      formData.append("image", file);
      formData.append("entityType", entityType);
      formData.append("entityId", entityId);

      const uploadRes = await fetch(`/api/upload/business-photo`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      const uploadData = await uploadRes.json().catch(() => null);
      if (!uploadRes.ok) {
        throw new Error(uploadData?.message || "Upload failed");
      }

      // Then add to gallery
      const res = await apiRequest(
        "POST",
        `/api/profiles/${entityType}/${entityId}/photos`,
        {
          url: uploadData.url || uploadData.imageUrl,
          width: uploadData.width || null,
          height: uploadData.height || null,
          mimeType: file.type,
          fileSize: uploadData.bytes || file.size,
        },
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["business-photos", entityType, entityId],
      });
      toast({ title: "Photo uploaded", description: "Your photo has been added to the gallery" });
    },
    onError: (error: any) => {
      toast({
        title: "Upload failed",
        description: error?.message || "Could not upload photo. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (photoId: string) => {
      const res = await apiRequest("DELETE", `/api/profiles/photos/${photoId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["business-photos", entityType, entityId],
      });
      toast({ title: "Photo removed" });
    },
  });

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;

      if (totalPhotos + files.length > maxPhotos) {
        toast({
          title: "Too many photos",
          description: `Maximum ${maxPhotos} photos per business. You can upload ${maxPhotos - totalPhotos} more.`,
          variant: "destructive",
        });
        return;
      }

      // Upload each file
      Array.from(files).forEach((file) => {
        if (!file.type.startsWith("image/")) {
          toast({
            title: "Invalid file",
            description: "Only image files are accepted",
            variant: "destructive",
          });
          return;
        }

        if (file.size > 10 * 1024 * 1024) {
          toast({
            title: "File too large",
            description: "Maximum file size is 10MB",
            variant: "destructive",
          });
          return;
        }

        uploadMutation.mutate(file);
      });

      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [totalPhotos, maxPhotos, uploadMutation, toast],
  );

  const sourceIcon = (source: string, provider?: string) => {
    if (provider === "google" || source === "google") {
      return <Globe className="h-3 w-3" />;
    }
    if (provider === "facebook" || source === "facebook") {
      return <Facebook className="h-3 w-3" />;
    }
    return <Camera className="h-3 w-3" />;
  };

  const sourceLabel = (source: string, provider?: string) => {
    if (provider === "google" || source === "google") return "Google";
    if (provider === "facebook" || source === "facebook") return "Facebook";
    return "Uploaded";
  };

  // ── Compact view ──────────────────────────────────────────────────────

  if (compact) {
    const allPhotos = [
      ...gallery.map((p) => ({ url: p.url, source: p.sourceProvider || p.source })),
      ...googlePhotos.map((p) => ({ url: p.url, source: "google" })),
    ];

    if (allPhotos.length === 0) return null;

    return (
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {allPhotos.slice(0, 6).map((photo, idx) => (
          <img
            key={idx}
            src={photo.url}
            alt=""
            className="h-16 w-16 rounded-md object-cover flex-shrink-0"
          />
        ))}
        {allPhotos.length > 6 && (
          <div className="h-16 w-16 rounded-md bg-muted flex items-center justify-center text-xs text-muted-foreground flex-shrink-0">
            +{allPhotos.length - 6}
          </div>
        )}
      </div>
    );
  }

  // ── Full gallery view ─────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <ImageIcon className="h-5 w-5" />
              Photo Gallery
            </CardTitle>
            <CardDescription>
              {totalPhotos} of {maxPhotos} photos
              {googlePhotos.length > 0 && ` • ${googlePhotos.length} from Google`}
            </CardDescription>
          </div>
          {canEdit && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending || totalPhotos >= maxPhotos}
                className="gap-1.5"
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                Add Photos
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : gallery.length === 0 && googlePhotos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <ImageIcon className="h-10 w-10 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No photos yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Upload your best photos or import from Google/Facebook
            </p>
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 gap-1.5"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" />
                Upload Photos
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Uploaded / imported photos */}
            {gallery.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                  Your Photos
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                  {gallery.map((photo) => (
                    <div
                      key={photo.id}
                      className="group relative aspect-square rounded-lg overflow-hidden border"
                    >
                      <img
                        src={photo.url}
                        alt={photo.caption || ""}
                        className="h-full w-full object-cover"
                      />
                      {/* Source badge */}
                      <div className="absolute top-1 left-1">
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1 py-0 gap-0.5 bg-black/50 text-white border-0"
                        >
                          {sourceIcon(photo.source, photo.sourceProvider)}
                          {sourceLabel(photo.source, photo.sourceProvider)}
                        </Badge>
                      </div>
                      {/* Featured badge */}
                      {photo.isFeatured && (
                        <div className="absolute top-1 right-1">
                          <Badge className="text-[10px] px-1 py-0 bg-amber-500 border-0">
                            <Star className="h-2.5 w-2.5 mr-0.5" />
                            Featured
                          </Badge>
                        </div>
                      )}
                      {/* Delete overlay */}
                      {canEdit && (
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Button
                            variant="destructive"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => deleteMutation.mutate(photo.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Google photos */}
            {googlePhotos.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  From Google Places
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                  {googlePhotos.map((photo, idx) => (
                    <div
                      key={`google-${idx}`}
                      className="relative aspect-square rounded-lg overflow-hidden border"
                    >
                      <img
                        src={photo.url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                      {photo.attribution && (
                        <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[9px] px-1 py-0.5 truncate">
                          {photo.attribution}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Upload prompt */}
            {canEdit && totalPhotos < maxPhotos && (
              <div className="text-center pt-2">
                <p className="text-xs text-muted-foreground">
                  Share your newest and best photos to attract more customers.
                  You can add {maxPhotos - totalPhotos} more.
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
