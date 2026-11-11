Pod::Spec.new do |s|
  s.name           = 'BackgroundTime'
  s.version        = '1.0.0'
  s.summary        = 'Background execution time for notification actions (UIApplication.beginBackgroundTask).'
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
