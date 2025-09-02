# GPU-Accelerated Build Setup for React Native
# This script optimizes the environment for faster builds using NVIDIA GPU

Write-Host "🚀 Setting up GPU-accelerated build environment..." -ForegroundColor Green

# Set CUDA environment variables
$env:CUDA_PATH = "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.9"
$env:CUDA_HOME = $env:CUDA_PATH

# Add CUDA to PATH if not already present
if ($env:PATH -notlike "*$env:CUDA_PATH\bin*") {
    $env:PATH = "$env:CUDA_PATH\bin;$env:PATH"
}

# Set Android SDK environment (fixing the conflict we had earlier)
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
if (-not $env:ANDROID_HOME) {
    Write-Warning "ANDROID_HOME not set. Please set it to your Android SDK location."
}

# Set optimized Gradle environment variables
$env:GRADLE_OPTS = "-Xmx4g -XX:MaxMetaspaceSize=1g -XX:+UseG1GC -XX:+UseStringDeduplication"

# Enable NDK parallel builds
$env:NDK_CCACHE = "1"

# Set optimal number of parallel jobs based on CPU cores
$cores = (Get-WmiObject -Class Win32_ComputerSystem).NumberOfLogicalProcessors
$env:MAKEFLAGS = "-j$cores"

# Enable Gradle daemon for faster subsequent builds
$env:GRADLE_DAEMON = "true"

Write-Host "✅ Environment configured:" -ForegroundColor Green
Write-Host "   - CUDA Path: $env:CUDA_PATH" -ForegroundColor Cyan
Write-Host "   - Android SDK: $env:ANDROID_SDK_ROOT" -ForegroundColor Cyan
Write-Host "   - Parallel jobs: $cores" -ForegroundColor Cyan
Write-Host "   - Gradle memory: 4GB" -ForegroundColor Cyan

Write-Host "🏗️  Ready to build with GPU acceleration!" -ForegroundColor Green
Write-Host "Run: npm run android" -ForegroundColor Yellow
