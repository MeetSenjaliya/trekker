'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/utils/supabase/client';
import { compressImage, sanitizeFileName } from '@/utils/imageCompression';
import { trekFormSchema, difficultyValues, fieldErrors } from '@/lib/schemas';
import { createTrek, updateTrek, type EditableTrek, type TrekInput } from '@/lib/company';
import { queryKeys } from '@/lib/queries';
import { UploadError, uploadErrorMessage } from '@/lib/uploadErrors';

interface TrekFormProps {
  companyId: string;
  trek?: EditableTrek;
}

const toStr = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

const inputClass = (hasError: boolean) =>
  `block w-full rounded-xl border px-4 py-3 text-gray-900 placeholder-gray-500 focus:outline-hidden sm:text-sm transition-colors ${
    hasError
      ? 'border-red-300 bg-red-50 focus:border-red-500'
      : 'border-gray-300 bg-gray-50 focus:border-blue-500'
  }`;

export default function TrekForm({ companyId, trek }: TrekFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    title: trek?.title ?? '',
    difficulty: trek?.difficulty ?? '',
    location: trek?.location ?? '',
    distanceKm: toStr(trek?.distance_km),
    durationHours: toStr(trek?.duration_hours),
    estimatedCost: toStr(trek?.estimated_cost),
    maxParticipants: toStr(trek?.max_participants),
    meetingPoint: trek?.meeting_point ?? '',
    meetingPoint2: trek?.meeting_point2 ?? '',
    description: trek?.description ?? '',
    gearChecklist: (trek?.gear_checklist ?? []).join('\n'),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(trek?.cover_image_url ?? null);
  const [saving, setSaving] = useState(false);

  const change = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
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

  const onCover = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.');
      return;
    }
    const compressed = await compressImage(file);
    setCoverFile(compressed);
    setCoverPreview(URL.createObjectURL(compressed));
  };

  // Uploads the cover to trek-images/{companyId}/{trekId}/… and returns the
  // public URL. Storage RLS keys writes to the first path segment (company id).
  const uploadCover = async (trekId: string): Promise<string | null> => {
    if (!coverFile) return null;
    const supabase = createClient();
    const path = `${companyId}/${trekId}/${Date.now()}-${sanitizeFileName(coverFile.name)}`;
    const { error } = await supabase.storage.from('trek-images').upload(path, coverFile, { upsert: true });
    if (error) {
      throw new UploadError(await uploadErrorMessage(error, supabase, 'trek-images'));
    }
    return supabase.storage.from('trek-images').getPublicUrl(path).data.publicUrl;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = trekFormSchema.safeParse(form);
    if (!result.success) {
      setErrors(fieldErrors(result.error));
      return;
    }

    setSaving(true);
    try {
      const input: TrekInput = result.data;

      if (trek) {
        // undefined = leave cover_image_url untouched; null = the user removed it.
        const coverImageUrl = coverFile ? await uploadCover(trek.id) : coverPreview === null ? null : undefined;
        const res = await updateTrek(trek.id, { ...input, coverImageUrl });
        if (!res.success) {
          toast.error(res.message);
          return;
        }
        queryClient.invalidateQueries({ queryKey: queryKeys.trek(trek.id) });
      } else {
        const res = await createTrek(companyId, input);
        if (!res.success || !res.trekId) {
          toast.error(res.message);
          return;
        }
        // The trek row exists now. A cover-upload failure must NOT re-throw here,
        // or we'd skip the navigation below and a retry would create a duplicate.
        if (coverFile) {
          try {
            const coverUrl = await uploadCover(res.trekId);
            if (coverUrl) await updateTrek(res.trekId, { ...input, coverImageUrl: coverUrl });
          } catch {
            toast.warning('The trek was created, but the cover image failed to upload. Edit the trek to add it.');
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ['companies', companyId, 'treks'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.companyOverview(companyId) });
      toast.success(trek ? 'Trek updated.' : 'Trek created.');
      router.push('/dashboard/treks');
    } catch (err) {
      const message =
        err instanceof UploadError
          ? `The trek was saved, but the cover image did not upload. ${err.message}`
          : 'Something went wrong. Please try again.';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 space-y-5">
        <div>
          <label htmlFor="title" className="mb-1 block text-sm font-medium text-gray-700">
            Title *
          </label>
          <input id="title" name="title" value={form.title} onChange={change} className={inputClass(!!errors.title)} placeholder="Valley of Flowers Trek" />
          {errors.title && <p className="mt-1.5 text-sm text-red-600">{errors.title}</p>}
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="difficulty" className="mb-1 block text-sm font-medium text-gray-700">
              Difficulty *
            </label>
            <select id="difficulty" name="difficulty" value={form.difficulty} onChange={change} className={inputClass(!!errors.difficulty)}>
              <option value="" disabled>
                Select difficulty
              </option>
              {difficultyValues.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            {errors.difficulty && <p className="mt-1.5 text-sm text-red-600">{errors.difficulty}</p>}
          </div>
          <div>
            <label htmlFor="location" className="mb-1 block text-sm font-medium text-gray-700">
              Location
            </label>
            <input id="location" name="location" value={form.location} onChange={change} className={inputClass(!!errors.location)} placeholder="Uttarakhand, India" />
            {errors.location && <p className="mt-1.5 text-sm text-red-600">{errors.location}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <div>
            <label htmlFor="distanceKm" className="mb-1 block text-sm font-medium text-gray-700">
              Distance (km)
            </label>
            <input id="distanceKm" name="distanceKm" inputMode="decimal" value={form.distanceKm} onChange={change} className={inputClass(!!errors.distanceKm)} placeholder="38" />
            {errors.distanceKm && <p className="mt-1.5 text-sm text-red-600">{errors.distanceKm}</p>}
          </div>
          <div>
            <label htmlFor="durationHours" className="mb-1 block text-sm font-medium text-gray-700">
              Duration (hrs)
            </label>
            <input id="durationHours" name="durationHours" inputMode="decimal" value={form.durationHours} onChange={change} className={inputClass(!!errors.durationHours)} placeholder="72" />
            {errors.durationHours && <p className="mt-1.5 text-sm text-red-600">{errors.durationHours}</p>}
          </div>
          <div>
            <label htmlFor="estimatedCost" className="mb-1 block text-sm font-medium text-gray-700">
              Cost (₹)
            </label>
            <input id="estimatedCost" name="estimatedCost" inputMode="decimal" value={form.estimatedCost} onChange={change} className={inputClass(!!errors.estimatedCost)} placeholder="9500" />
            {errors.estimatedCost && <p className="mt-1.5 text-sm text-red-600">{errors.estimatedCost}</p>}
          </div>
          <div>
            <label htmlFor="maxParticipants" className="mb-1 block text-sm font-medium text-gray-700">
              Max people
            </label>
            <input id="maxParticipants" name="maxParticipants" inputMode="numeric" value={form.maxParticipants} onChange={change} className={inputClass(!!errors.maxParticipants)} placeholder="15" />
            {errors.maxParticipants && <p className="mt-1.5 text-sm text-red-600">{errors.maxParticipants}</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="meetingPoint" className="mb-1 block text-sm font-medium text-gray-700">
              Meeting point
            </label>
            <input id="meetingPoint" name="meetingPoint" value={form.meetingPoint} onChange={change} className={inputClass(!!errors.meetingPoint)} placeholder="Rishikesh bus stand" />
            {errors.meetingPoint && <p className="mt-1.5 text-sm text-red-600">{errors.meetingPoint}</p>}
          </div>
          <div>
            <label htmlFor="meetingPoint2" className="mb-1 block text-sm font-medium text-gray-700">
              Alternate meeting point
            </label>
            <input id="meetingPoint2" name="meetingPoint2" value={form.meetingPoint2} onChange={change} className={inputClass(!!errors.meetingPoint2)} placeholder="Haridwar station" />
            {errors.meetingPoint2 && <p className="mt-1.5 text-sm text-red-600">{errors.meetingPoint2}</p>}
          </div>
        </div>

        <div>
          <label htmlFor="description" className="mb-1 block text-sm font-medium text-gray-700">
            Description
          </label>
          <textarea id="description" name="description" rows={5} value={form.description} onChange={change} className={inputClass(!!errors.description)} placeholder="What makes this trek special?" />
          {errors.description && <p className="mt-1.5 text-sm text-red-600">{errors.description}</p>}
        </div>

        <div>
          <label htmlFor="gearChecklist" className="mb-1 block text-sm font-medium text-gray-700">
            Gear checklist
          </label>
          <textarea id="gearChecklist" name="gearChecklist" rows={4} value={form.gearChecklist} onChange={change} className={inputClass(!!errors.gearChecklist)} placeholder="One item per line&#10;Trekking shoes&#10;Rain jacket" />
          <p className="mt-1 text-xs text-gray-500">One item per line.</p>
          {errors.gearChecklist && <p className="mt-1.5 text-sm text-red-600">{errors.gearChecklist}</p>}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Cover image</label>
          {coverPreview ? (
            <div className="relative w-full max-w-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={coverPreview} alt="Cover preview" className="h-40 w-full rounded-xl border border-gray-200 object-cover" />
              <button
                type="button"
                onClick={() => {
                  setCoverFile(null);
                  setCoverPreview(null);
                }}
                className="absolute -right-2 -top-2 rounded-full bg-red-500 p-1 text-white transition-colors hover:bg-red-600"
                aria-label="Remove cover image"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="relative max-w-sm">
              <input type="file" accept="image/*" onChange={onCover} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 px-6 py-8 text-center hover:border-blue-400">
                <ImagePlus className="h-8 w-8 text-gray-400" />
                <p className="text-sm text-gray-600">Click to upload a cover image</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={() => router.push('/dashboard/treks')}
          className="rounded-full border border-gray-300 px-6 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {trek ? 'Save changes' : 'Create trek'}
        </button>
      </div>
    </form>
  );
}
