-- Backfill existing users into the profiles table
INSERT INTO public.profiles (id, email, role, subscription_status)
SELECT id, email, 'client', 'trial'
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles);
