Pod::Spec.new do |s|
  s.name           = 'BuildersBotShareExtension'
  s.version        = '1.0.0'
  s.summary        = 'Share extension data for Builders Bot'
  s.description    = 'Gives the share extension the session of the app, and offers agents in the share sheet.'
  s.license        = 'SEE LICENSE IN LICENSE'
  s.author         = 'CULTURA BUILDER EDUCACAO E TECNOLOGIA LTDA'
  s.homepage       = 'https://buildersbot.culturabuilder.com'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.swift"
  s.frameworks = 'Intents', 'Security'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
