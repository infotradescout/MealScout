import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Upload, X, FileText, Image, Eye, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface DocumentFile {
  id: string;
  file: File;
  dataUrl: string;
  type: 'image' | 'pdf';
  size: number;
  name: string;
}

interface DocumentUploadProps {
  onDocumentsChange: (documents: string[]) => void;
  maxFiles?: number;
  maxFileSize?: number; // in bytes
  acceptedTypes?: string[];
  className?: string;
}

const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
  'application/pdf',
];
const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.pdf'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;

export default function DocumentUpload({
  onDocumentsChange,
  maxFiles = MAX_FILES,
  maxFileSize = MAX_FILE_SIZE,
  acceptedTypes = ACCEPTED_TYPES,
  className
}: DocumentUploadProps) {
  const [documents, setDocuments] = useState<DocumentFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [previewDocument, setPreviewDocument] = useState<DocumentFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const isAcceptedFileType = (file: File) => {
    const type = String(file.type || '').toLowerCase();
    const name = String(file.name || '').toLowerCase();
    return (
      acceptedTypes.includes(type) ||
      ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension))
    );
  };

  const validateFile = (
    file: File,
    nextCount: number,
  ): { valid: boolean; error?: string } => {
    if (!isAcceptedFileType(file)) {
      return {
        valid: false,
        error: `File type ${file.type || file.name} is not supported. Please upload JPG, PNG, WEBP, HEIC, HEIF, or PDF files.`
      };
    }

    if (file.size > maxFileSize) {
      return {
        valid: false,
        error: `File size ${formatFileSize(file.size)} exceeds the maximum limit of ${formatFileSize(maxFileSize)}.`
      };
    }

    if (nextCount > maxFiles) {
      return {
        valid: false,
        error: `Maximum ${maxFiles} files allowed.`
      };
    }

    return { valid: true };
  };

  const convertToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
      reader.readAsDataURL(file);
    });
  };

  const uploadDocument = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('document', file);
    const response = await fetch('/api/upload/verification-document', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || 'Failed to upload document');
    }
    if (!payload?.url) {
      throw new Error('Document upload did not return a file URL');
    }
    return payload.url;
  };

  const processFiles = useCallback(async (files: FileList | File[]) => {
    setIsUploading(true);
    const fileArray = Array.from(files);
    const newDocuments: DocumentFile[] = [];

    for (const file of fileArray) {
      const validation = validateFile(file, documents.length + newDocuments.length + 1);
      
      if (!validation.valid) {
        toast({
          title: "Upload Error",
          description: validation.error,
          variant: "destructive",
        });
        continue;
      }

      try {
        let dataUrl: string;
        try {
          dataUrl = await uploadDocument(file);
        } catch (uploadError: any) {
          const message = String(uploadError?.message || '').toLowerCase();
          if (!message.includes('not configured') && !message.includes('not found')) {
            throw uploadError;
          }
          dataUrl = await convertToBase64(file);
        }
        const lowerName = file.name.toLowerCase();
        const docType =
          file.type.startsWith('image/') ||
          ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].some((extension) =>
            lowerName.endsWith(extension),
          )
            ? 'image'
            : 'pdf';
        
        const document: DocumentFile = {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          file,
          dataUrl,
          type: docType,
          size: file.size,
          name: file.name,
        };

        newDocuments.push(document);
      } catch (error) {
        toast({
          title: "Upload Error",
          description: `Failed to process file: ${file.name}`,
          variant: "destructive",
        });
      }
    }

    if (newDocuments.length > 0) {
      const updatedDocuments = [...documents, ...newDocuments];
      setDocuments(updatedDocuments);
      onDocumentsChange(updatedDocuments.map(doc => doc.dataUrl));
      
      toast({
        title: "Upload Successful",
        description: `${newDocuments.length} file(s) uploaded successfully.`,
      });
    }

    setIsUploading(false);
  }, [documents, onDocumentsChange, toast, maxFiles, maxFileSize, acceptedTypes]);

  const removeDocument = (id: string) => {
    const updatedDocuments = documents.filter(doc => doc.id !== id);
    setDocuments(updatedDocuments);
    onDocumentsChange(updatedDocuments.map(doc => doc.dataUrl));
    
    toast({
      title: "File Removed",
      description: "Document has been removed from upload list.",
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      processFiles(files);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFiles(files);
    }
    // Reset the input value to allow uploading the same file again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* Upload Area */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Upload className="w-5 h-5" />
            <span>Upload Business Documents</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer",
              dragOver 
                ? "border-primary bg-primary/5" 
                : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={openFileDialog}
            data-testid="upload-dropzone"
          >
            <Upload className="mx-auto h-12 w-12 text-[color:var(--text-muted)] mb-4" />
            <div className="space-y-2">
              <p className="text-lg font-medium">Drop files here or click to upload</p>
              <p className="text-sm text-[color:var(--text-muted)]">
                Supported formats: JPG, PNG, WEBP, HEIC, HEIF, PDF (max {formatFileSize(maxFileSize)} each)
              </p>
              <p className="text-xs text-[color:var(--text-muted)]">
                Maximum {maxFiles} files allowed
              </p>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={[...acceptedTypes, ...ACCEPTED_EXTENSIONS].join(',')}
            onChange={handleFileInputChange}
            className="hidden"
            data-testid="file-input"
          />

          {isUploading && (
            <div className="mt-4 flex items-center space-x-2 text-sm text-[color:var(--text-muted)]">
              <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
              <span>Processing files...</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Uploaded Documents List */}
      {documents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Uploaded Documents ({documents.length}/{maxFiles})</span>
              <Badge variant="secondary">{formatFileSize(documents.reduce((acc, doc) => acc + doc.size, 0))}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-[var(--bg-surface)]"
                  data-testid={`document-item-${doc.id}`}
                >
                  <div className="flex-shrink-0">
                    {doc.type === 'image' ? (
                      <Image className="w-6 h-6 text-[color:var(--accent-text)]" />
                    ) : (
                      <FileText className="w-6 h-6 text-[color:var(--status-error)]" />
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{doc.name}</p>
                    <p className="text-xs text-[color:var(--text-muted)]">{formatFileSize(doc.size)}</p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPreviewDocument(doc)}
                      data-testid={`preview-button-${doc.id}`}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => removeDocument(doc.id)}
                      data-testid={`remove-button-${doc.id}`}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {documents.length === maxFiles && (
              <div className="mt-4 flex items-center space-x-2 text-sm text-amber-600">
                <AlertCircle className="w-4 h-4" />
                <span>Maximum file limit reached. Remove files to upload more.</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Preview Modal */}
      {previewDocument && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setPreviewDocument(null)}
          data-testid="preview-modal"
        >
          <div 
            className="bg-[var(--bg-surface)] rounded-lg max-w-4xl max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-medium">{previewDocument.name}</h3>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPreviewDocument(null)}
                data-testid="close-preview"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-4">
              {previewDocument.type === 'image' ? (
                <img
                  src={previewDocument.dataUrl}
                  alt={previewDocument.name}
                  className="max-w-full h-auto"
                  data-testid="preview-image"
                />
              ) : (
                <div className="text-center py-8">
                  <FileText className="w-16 h-16 mx-auto text-[color:var(--text-muted)] mb-4" />
                  <p className="text-lg font-medium">PDF Preview</p>
                  <p className="text-sm text-[color:var(--text-muted)] mt-2">
                    {previewDocument.name} - {formatFileSize(previewDocument.size)}
                  </p>
                  <p className="text-xs text-[color:var(--text-muted)] mt-4">
                    PDF files will be processed when you submit the verification request
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

