import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

export async function uploadAvatar(userId: string, file: File) {
  const { data } = await supabase.storage.from('avatars').upload(`${userId}.png`, file, { upsert: true });
  return supabase.storage.from('avatars').getPublicUrl(data!.path).data.publicUrl;
}
