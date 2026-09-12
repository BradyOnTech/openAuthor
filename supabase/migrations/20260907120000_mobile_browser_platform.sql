-- Additive: existing native enrollment and session-bound authorization remain unchanged.
alter type public.mobile_device_platform add value if not exists 'web';
