-- Migration: Add approval_status to profiles and update trigger

-- 1. Add the column
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending' 
CHECK (approval_status IN ('pending', 'approved', 'rejected'));

-- 2. Update the trigger function for new signups
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role, subscription_status, approval_status)
  VALUES (
    NEW.id,
    NEW.email,
    'client',
    'trial',
    'pending'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Grandfather in the admin user
UPDATE public.profiles 
SET role = 'admin', approval_status = 'approved' 
WHERE email = 'guyderi97@gmail.com';

-- 4. Automatically approve existing users (Optional, but good for backward compatibility so current users aren't locked out)
UPDATE public.profiles
SET approval_status = 'approved'
WHERE email != 'guyderi97@gmail.com' AND approval_status = 'pending';
