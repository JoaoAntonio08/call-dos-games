#!/usr/bin/env bash
# Gera o APK do Call dos Games só com o Android SDK (build-tools 35 + platform 35) e um JDK 17.
# Uso: bash android/build.sh   ->  android/build/Call-dos-Games-<versão>.apk
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
BT="$SDK/build-tools/35.0.0"
JAR="$SDK/platforms/android-35/android.jar"
JAVA_HOME="${JAVA_HOME:-/c/Program Files/Eclipse Adoptium/jdk-17.0.9.9-hotspot}"
export JAVA_HOME PATH="$JAVA_HOME/bin:$PATH"
EXT=""; [[ -f "$BT/aapt2.exe" ]] && EXT=".exe"; BAT=""; [[ -f "$BT/d8.bat" ]] && BAT=".bat"
VER=$(sed -n 's/.*VERSION = "\(.*\)".*/\1/p' app/src/main/java/com/calldosgames/app/BuildInfo.java)
CODE=$(sed -n 's/.*CODE = \([0-9]*\).*/\1/p' app/src/main/java/com/calldosgames/app/BuildInfo.java)
M=app/src/main
O=build
rm -rf "$O"; mkdir -p "$O/gen" "$O/classes" "$O/dex"

"$BT/aapt2$EXT" compile --dir "$M/res" -o "$O/res.zip"
"$BT/aapt2$EXT" link -o "$O/base.apk" -I "$JAR" --manifest "$M/AndroidManifest.xml" -A "$M/assets" \
  --java "$O/gen" --min-sdk-version 24 --target-sdk-version 34 --version-code "$CODE" --version-name "$VER" "$O/res.zip"
javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 -bootclasspath "$JAR" -classpath "$BT/core-lambda-stubs.jar" -d "$O/classes" \
  $(find "$M/java" "$O/gen" -name '*.java')
"$BT/d8$BAT" --release --min-api 24 --lib "$JAR" --output "$O/dex" $(find "$O/classes" -name '*.class')
python -c "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],'a',zipfile.ZIP_DEFLATED); z.write(sys.argv[2],'classes.dex'); z.close()" "$O/base.apk" "$O/dex/classes.dex"
"$BT/zipalign$EXT" -f -p 4 "$O/base.apk" "$O/alinhado.apk"

# Assinatura: android/keystore/ (fora do git). Sem a chave não dá para atualizar o app depois — guarde backup!
P=keystore/keystore.properties
prop() { sed -n "s/^$1=//p" "$P" | tr -d '\r'; }
export CDG_KS_PASS="$(prop storePassword)" CDG_KEY_PASS="$(prop keyPassword)"
"$BT/apksigner$BAT" sign --ks "keystore/$(basename "$(prop storeFile)")" --ks-key-alias "$(prop keyAlias)" \
  --ks-pass env:CDG_KS_PASS --key-pass env:CDG_KEY_PASS --out "$O/Call-dos-Games-$VER.apk" "$O/alinhado.apk"
"$BT/apksigner$BAT" verify "$O/Call-dos-Games-$VER.apk"
echo "APK pronto: android/$O/Call-dos-Games-$VER.apk"
