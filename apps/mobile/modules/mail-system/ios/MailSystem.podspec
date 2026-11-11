Pod::Spec.new do |s|
  s.name           = 'MailSystem'
  s.version        = '1.0.0'
  s.summary        = 'iOS system glue of the mail app: background time for notification actions, the launch quick action.'
  s.description    = s.summary
  s.author         = 'Freecorps'
  s.homepage       = 'https://github.com/freecorps/mail'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.{h,m,swift}'
end
