import React, { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiUrl } from '@/lib/api';

interface VideoUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  restaurantId?: string;
  replyToStoryId?: string;
  replyToStoryTitle?: string;
}

export function VideoUploadModal({
  isOpen,
  onClose,
  restaurantId,
  replyToStoryId,
  replyToStoryTitle,
}: VideoUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [hashtagInput, setHashtagInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [duration, setDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [alreadyRecommended, setAlreadyRecommended] = useState<boolean | null>(null);
  const queryClient = useQueryClient();

  if (!isOpen) return null;

  useEffect(() => {
    if (!isOpen || !restaurantId) {
      setAlreadyRecommended(null);
      return;
    }

    let cancelled = false;

    const checkRecommendationStatus = async () => {
      try {
        const response = await fetch(
          apiUrl(`/api/stories/recommendation-status?restaurantId=${encodeURIComponent(restaurantId)}`),
          {
            credentials: 'include',
          }
        );

        if (!response.ok) {
          return;
        }

        const data = await response.json();
        if (!cancelled) {
          setAlreadyRecommended(Boolean(data.alreadyRecommended));
        }
      } catch {
        if (!cancelled) {
          setAlreadyRecommended(null);
        }
      }
    };

    checkRecommendationStatus();

    return () => {
      cancelled = true;
    };
  }, [isOpen, restaurantId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // Check file size (50MB max)
      if (selectedFile.size > 50 * 1024 * 1024) {
        setError('Video file must be less than 50MB');
        return;
      }

      // Check video duration
      const video = document.createElement('video');
      video.onloadedmetadata = () => {
        if (video.duration > 30) {
          setError('Video must be 30 seconds or less');
          return;
        }
        setDuration(Math.round(video.duration));
        setFile(selectedFile);
        setError('');
      };
      video.src = URL.createObjectURL(selectedFile);
    }
  };

  const handleAddHashtag = () => {
    if (hashtagInput.trim() && !hashtagInput.startsWith('#')) {
      const tag = `#${hashtagInput.trim()}`;
      if (hashtags.length < 10) {
        setHashtags([...hashtags, tag]);
        setHashtagInput('');
      }
    } else if (hashtagInput.trim().startsWith('#')) {
      if (hashtags.length < 10) {
        setHashtags([...hashtags, hashtagInput.trim()]);
        setHashtagInput('');
      }
    }
  };

  const handleRemoveHashtag = (tag: string) => {
    setHashtags(hashtags.filter((t) => t !== tag));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title) {
      setError('Please select a video and enter a title');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('video', file);
      formData.append('title', title);
      formData.append('description', description);
      formData.append('duration', String(duration));
      if (restaurantId) {
        formData.append('restaurantId', restaurantId);
      }
      if (replyToStoryId) {
        formData.append('replyToStoryId', replyToStoryId);
      }
      formData.append('hashtags', JSON.stringify(hashtags));

      const response = await fetch(apiUrl('/api/stories/upload'), {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to upload video');
      }

      // Invalidate feed queries to refresh
      queryClient.invalidateQueries({ queryKey: ['stories-feed'] });

      setFile(null);
      setTitle('');
      setDescription('');
      setHashtags([]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-[var(--bg-surface)] rounded-lg shadow-clean-lg w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-[var(--border-subtle)] flex justify-between items-center">
          <h2 className="text-xl font-bold">Share Your Food Story</h2>
          <button
            onClick={onClose}
            className="text-[color:var(--text-muted)] hover:text-[color:var(--text-muted)]"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-[color:var(--status-error)]/10 border border-red-200 rounded text-[color:var(--status-error)] text-sm">
              {error}
            </div>
          )}

          {/* Lifetime info */}
          <p className="text-xs text-[color:var(--text-muted)]">
            Videos appear in MealScout for 7 days.
          </p>

          {replyToStoryId && (
            <p className="text-xs text-[color:var(--status-info)] bg-[color:var(--status-info)]/10 border border-[color:var(--status-info)]/30 rounded px-2 py-1">
              Replying to: {replyToStoryTitle || 'Video story'}
            </p>
          )}

          {/* Duplicate recommendation notice (non-blocking) */}
          {restaurantId && alreadyRecommended && (
            <p className="text-xs text-amber-600">
              Already recommended — still OK to post, but it won&apos;t increase your recommendation count.
            </p>
          )}

          {/* Recommendation hint (soft, non-blocking) */}
          {!restaurantId && (
            <p className="text-xs text-[color:var(--text-muted)]">
              Tag a restaurant so this counts as a recommendation. You can recommend each restaurant once.
            </p>
          )}

          {/* Video Upload */}
          <div>
            <label className="block text-sm font-medium text-[color:var(--text-secondary)] mb-2">
              Video (max 30 seconds, max 50MB)
            </label>
            <input
              type="file"
              accept="video/*"
              onChange={handleFileChange}
              disabled={isLoading}
              className="w-full p-2 border border-[var(--border-subtle)] rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {file && (
              <p className="mt-2 text-sm text-[color:var(--status-success)]">
                ✓ Video selected ({duration}s)
              </p>
            )}
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-[color:var(--text-secondary)] mb-2">
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 100))}
              placeholder="What did you eat? (max 100 chars)"
              maxLength={100}
              disabled={isLoading}
              className="w-full p-2 border border-[var(--border-subtle)] rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-[color:var(--text-muted)] mt-1">{title.length}/100</p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-[color:var(--text-secondary)] mb-2">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 500))}
              placeholder="Tell us more about your experience..."
              maxLength={500}
              disabled={isLoading}
              rows={3}
              className="w-full p-2 border border-[var(--border-subtle)] rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
            <p className="text-xs text-[color:var(--text-muted)] mt-1">{description.length}/500</p>
          </div>

          {/* Hashtags */}
          <div>
            <label className="block text-sm font-medium text-[color:var(--text-secondary)] mb-2">
              Hashtags (max 10)
            </label>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={hashtagInput}
                onChange={(e) => setHashtagInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddHashtag();
                  }
                }}
                placeholder="Add hashtags..."
                disabled={isLoading || hashtags.length >= 10}
                className="flex-1 p-2 border border-[var(--border-subtle)] rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={handleAddHashtag}
                disabled={isLoading || hashtags.length >= 10}
                className="px-3 py-2 bg-[var(--bg-subtle)] rounded hover:bg-[var(--bg-subtle)] disabled:opacity-50"
              >
                Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {hashtags.map((tag) => (
                <div
                  key={tag}
                  className="flex items-center gap-2 px-3 py-1 bg-[color:var(--accent-text)]/12 rounded-full text-sm text-[color:var(--accent-text)]"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveHashtag(tag)}
                    className="text-[color:var(--accent-text)] hover:text-[color:var(--accent-text)]"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-4 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="flex-1 py-2 px-4 border border-[var(--border-subtle)] rounded hover:bg-[var(--bg-surface)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !file || !title}
              className="flex-1 py-2 px-4 bg-[color:var(--accent-text)] text-white rounded hover:bg-[color:var(--accent-text-hover)] disabled:opacity-50"
            >
              {isLoading ? 'Uploading...' : 'Share Story'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

