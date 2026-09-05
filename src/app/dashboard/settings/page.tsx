'use client';

import React, { useState } from 'react';
import { Loader2, Building2, X, ImagePlus, Camera } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useDashboardCompany } from '@/components/admin/DashboardShell';
import { useRequireCompanyRole } from '@/hooks/useRequireCompanyRole';
import { createClient } from '@/utils/supabase/client';
import { compressImage, sanitizeFileName } from '@/utils/imageCompression';
import { companyProfileSchema, fieldErrors } from '@/lib/schemas';
import { updateCompany, isCompanyFrozen } from '@/lib/company';
import { UploadError, uploadErrorMessage } from '@/lib/uploadErrors';

const inputClass = (hasError: boolean) =>
  `block w-full rounded-xl border px-4 py-3 text-gray-900 placeholder-gray-500 focus:outline-hidden sm:text-sm transition-colors ${
    hasError ? 'border-red-300 bg-red-50 focus:border-red-500' : 'border-gray-300 bg-gray-50 focus:border-blue-500'
  }`;

export default function CompanySettingsPage() {
  const { company } = useDashboardCompany();
  const { permitted } = useRequireCompanyRole(['owner', 'admin']);
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: '',
    description: '',
    contactEmail: '',
    contactPhone: '',
    website: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Re-seed the form whenever the active company object changes — switching
  // company, or the refetch that follows a save (which also clears the pending
  // file inputs).
  const [seededCompany, setSeededCompany] = useState<typeof company>(undefined);
  if (company && seededCompany !== company) {
    setSeededCompany(company);
    setForm({
      name: company.name ?? '',
      description: company.description ?? '',
      contactEmail: company.contact_email ?? '',
      contactPhone: company.contact_phone ?? '',
      website: company.website ?? '',
    });
    setLogoPreview(company.logo_url ?? null);
    setLogoFile(null);
    setCoverPreview(company.cover_image_url ?? null);
    setCoverFile(null);
  }

  if (!company || !permitted) return null;

  // A rejected/suspended company is read-only (RLS refuses the update and the
  // logo/cover upload), so the whole form is disabled rather than left to fail.
  const frozen = isCompanyFrozen(company.status);

  const change = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const pickImage = async (
    e: React.ChangeEvent<HTMLInputElement>,
    setFile: (f: File) => void,
    setPreview: (url: string) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.');
      return;
    }
    const compressed = await compressImage(file);
    setFile(compressed);
    setPreview(URL.createObjectURL(compressed));
  };

  // Covers live in the same company-scoped bucket as logos; the `cover-` prefix
  // just keeps the two distinguishable when browsing storage.
  const uploadBrandImage = async (file: File, prefix: string): Promise<string | null> => {
    const supabase = createClient();
    const path = `${company.id}/${prefix}${Date.now()}-${sanitizeFileName(file.name)}`;
    const { error } = await supabase.storage.from('company-logos').upload(path, file, { upsert: true });
    if (error) {
      throw new UploadError(await uploadErrorMessage(error, supabase, 'company-logos'));
    }
    return supabase.storage.from('company-logos').getPublicUrl(path).data.publicUrl;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = companyProfileSchema.safeParse(form);
    if (!result.success) {
      setErrors(fieldErrors(result.error));
      return;
    }
    setSaving(true);
    try {
      // undefined = leave the column untouched; null = the user removed it.
      const logoUrl = logoFile
        ? await uploadBrandImage(logoFile, '')
        : logoPreview === null ? null : undefined;
      const coverImageUrl = coverFile
        ? await uploadBrandImage(coverFile, 'cover-')
        : coverPreview === null ? null : undefined;
      const res = await updateCompany(company.id, { ...result.data, logoUrl, coverImageUrl });
      if (!res.success) {
        toast.error(res.message);
        return;
      }
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ['companies', 'mine'] });
    } catch (err) {
      const message =
        err instanceof UploadError ? err.message : 'Something went wrong. Please try again.';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Company settings</h1>

      {frozen && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          These settings are read-only while {company.name} is {company.status}.
        </p>
      )}

      {/* Wrapping the form rather than its contents disables every control
          inside (including the file pickers and Save) without reshaping it. */}
      <fieldset disabled={frozen} className="disabled:opacity-60">
      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        {/* Brand header — cover banner with the logo overlapping, previewing
            how the public storefront hero will look. */}
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="relative h-40 sm:h-48 bg-gradient-to-br from-blue-500 via-sky-400 to-indigo-500">
            {coverPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverPreview} alt="Cover preview" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-white/80">
                <ImagePlus className="h-7 w-7" />
                <p className="text-sm font-medium">Add a cover photo for your storefront</p>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/30 to-transparent" />
            <div className="absolute right-3 top-3 flex items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-white/90 px-3.5 py-1.5 text-xs font-bold text-gray-800 shadow-xs backdrop-blur transition-colors hover:bg-white">
                <Camera className="h-3.5 w-3.5" />
                {coverPreview ? 'Change cover' : 'Upload cover'}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => pickImage(e, setCoverFile, setCoverPreview)}
                  className="hidden"
                />
              </label>
              {coverPreview && (
                <button
                  type="button"
                  onClick={() => {
                    setCoverFile(null);
                    setCoverPreview(null);
                  }}
                  aria-label="Remove cover image"
                  className="rounded-full bg-white/90 p-1.5 text-gray-600 shadow-xs backdrop-blur transition-colors hover:bg-white hover:text-red-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <div className="px-5 pb-5 sm:px-6">
            <div className="-mt-10 flex flex-wrap items-end gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gray-100 shadow-lg ring-4 ring-white">
                {logoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoPreview} alt="Logo preview" className="h-full w-full object-cover" />
                ) : (
                  <Building2 className="h-8 w-8 text-gray-300" />
                )}
              </div>
              <div className="flex items-center gap-2 pb-1">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50">
                  <Camera className="h-4 w-4" />
                  {logoPreview ? 'Change logo' : 'Upload logo'}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => pickImage(e, setLogoFile, setLogoPreview)}
                    className="hidden"
                  />
                </label>
                {logoPreview && (
                  <button
                    type="button"
                    onClick={() => {
                      setLogoFile(null);
                      setLogoPreview(null);
                    }}
                    className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-red-600"
                  >
                    <X className="h-4 w-4" />
                    Remove
                  </button>
                )}
              </div>
            </div>
            <p className="mt-3 text-xs text-gray-500">
              Shown on your public storefront at /company/{company.slug}.
            </p>
          </div>
        </div>

        <div className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium text-gray-700">
              Company name *
            </label>
            <input id="name" name="name" value={form.name} onChange={change} className={inputClass(!!errors.name)} />
            {errors.name && <p className="mt-1.5 text-sm text-red-600">{errors.name}</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Public URL</label>
            <p className="rounded-xl border border-gray-200 bg-gray-100 px-4 py-3 text-sm text-gray-500">
              /company/{company.slug}
              <span className="ml-2 text-xs text-gray-400">(can&apos;t be changed)</span>
            </p>
          </div>

          <div>
            <label htmlFor="description" className="mb-1 block text-sm font-medium text-gray-700">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              rows={4}
              value={form.description}
              onChange={change}
              className={inputClass(!!errors.description)}
            />
            {errors.description && <p className="mt-1.5 text-sm text-red-600">{errors.description}</p>}
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="contactEmail" className="mb-1 block text-sm font-medium text-gray-700">
                Contact email
              </label>
              <input
                id="contactEmail"
                name="contactEmail"
                type="email"
                value={form.contactEmail}
                onChange={change}
                className={inputClass(!!errors.contactEmail)}
              />
              {errors.contactEmail && <p className="mt-1.5 text-sm text-red-600">{errors.contactEmail}</p>}
            </div>
            <div>
              <label htmlFor="contactPhone" className="mb-1 block text-sm font-medium text-gray-700">
                Contact phone
              </label>
              <input
                id="contactPhone"
                name="contactPhone"
                type="tel"
                value={form.contactPhone}
                onChange={change}
                className={inputClass(!!errors.contactPhone)}
              />
              {errors.contactPhone && <p className="mt-1.5 text-sm text-red-600">{errors.contactPhone}</p>}
            </div>
          </div>

          <div>
            <label htmlFor="website" className="mb-1 block text-sm font-medium text-gray-700">
              Website
            </label>
            <input
              id="website"
              name="website"
              type="url"
              value={form.website}
              onChange={change}
              placeholder="https://example.com"
              className={inputClass(!!errors.website)}
            />
            {errors.website && <p className="mt-1.5 text-sm text-red-600">{errors.website}</p>}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save changes
          </button>
        </div>
      </form>
      </fieldset>
    </div>
  );
}
