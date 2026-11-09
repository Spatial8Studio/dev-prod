function metadata = spatializeAudio(inputFile, outputFile, startPosition, varargin)
%SPATIALIZEAUDIO Moving 3-D binaural MP3 renderer.
%
% Coordinate system:
%   +X = front
%   -X = behind
%   +Y = left
%   -Y = right
%   +Z = above
%   -Z = below
%
% The source moves:
%   start -> destination -> start -> destination ...
%
% Example:
% spatializeAudio("input.mp3", "output.mp3", [2 1 0.5], ...
%     "EndPosition", [-2 -1 1], ...
%     "TravelTime", 10, ...
%     "AllowSynthetic", true);

%% Default options

endPosition = startPosition;
travelTime = 10;
blockSize = 1024;
allowSynthetic = false;
ffmpegPath = "ffmpeg";
mp3Bitrate = "320k";
hrirFile = "";
normalizeOutput = true;
headRadius = 0.0875;
speedOfSound = 343;
applyExtraITD = false;
highPassHz = 28;
noiseGateDb = -72;
% Elevation is disabled for pure Left/Right earphone rendering.
elevationCueStrength = 0;

%% Read name-value options

if mod(length(varargin), 2) ~= 0
    error("Options must be supplied as name-value pairs.");
end

for k = 1:2:length(varargin)

    optionName = lower(string(varargin{k}));
    optionValue = varargin{k + 1};

    switch optionName

        case "endposition"
            endPosition = double(optionValue);

        case "traveltime"
            travelTime = double(optionValue);

        case "blocksize"
            blockSize = double(optionValue);

        case "allowsynthetic"
            allowSynthetic = logical(optionValue);

        case "ffmpegpath"
            ffmpegPath = string(optionValue);

        case "mp3bitrate"
            mp3Bitrate = string(optionValue);

        case "hrirfile"
            hrirFile = string(optionValue);

        case "normalize"
            normalizeOutput = logical(optionValue);

        case "headradius"
            headRadius = double(optionValue);

        case "speedofsound"
            speedOfSound = double(optionValue);

        case "applyextraitd"
            applyExtraITD = logical(optionValue);

        case "highpasshz"
            highPassHz = double(optionValue);

        case "noisegatedb"
            noiseGateDb = double(optionValue);

        case "elevationcuestrength"
            elevationCueStrength = double(optionValue);

        otherwise
            error("Unknown option: " + optionName);
    end
end

%% Validate inputs

if length(startPosition) ~= 3
    error("Start position must be [x1 y1 z1].");
end

if length(endPosition) ~= 3
    error("End position must be [x2 y2 z2].");
end

if norm(startPosition) == 0 || norm(endPosition) == 0
    error("Source positions cannot be [0 0 0].");
end

if travelTime <= 0
    error("TravelTime must be greater than zero.");
end

if blockSize <= 0 || mod(blockSize, 1) ~= 0
    error("BlockSize must be a positive integer.");
end

if ~isscalar(elevationCueStrength) || ~isfinite(elevationCueStrength) || ...
        elevationCueStrength < 0
    error("ElevationCueStrength must be a finite nonnegative scalar.");
end

if ~isfile(inputFile)
    error("Input file not found: " + inputFile);
end

%% Read input MP3 or WAV

[source, sampleRate] = audioread(inputFile);

if isempty(source)
    error("Input audio is empty.");
end

% Convert stereo input to mono.
if size(source, 2) > 1
    source = mean(source, 2);
end

source = double(source(:));

% Conservative cleanup: remove DC/very-low-frequency rumble and attenuate only
% the quietest noise floor without hard-gating musical tails.
source = removeRumble(source, sampleRate, highPassHz);
source = applySoftNoiseGate(source, sampleRate, noiseGateDb);

%% Load measured HRIR data if supplied

[hrirData, hrirSampleRate] = loadHrir(hrirFile);

% CIPIC HRIRs are measured at 44.1 kHz. Resampling the short HRIRs here
% keeps the input audio rate flexible while preserving the measured cues.
if ~isempty(hrirSampleRate) && hrirSampleRate ~= sampleRate
    hrirData = resampleHrirData(hrirData, hrirSampleRate, sampleRate);
    hrirSampleRate = sampleRate;
end

if isempty(hrirData) && ~allowSynthetic
    error("Provide HrirFile or set AllowSynthetic to true.");
end

%% Render moving source

numberOfSamples = length(source);

% Output length includes the HRIR tail.
if isempty(hrirData)
    maximumHrirLength = 3;
else
    maximumHrirLength = size(hrirData.left, 1);
end

leftOutput = zeros(numberOfSamples + maximumHrirLength - 1, 1);
rightOutput = zeros(numberOfSamples + maximumHrirLength - 1, 1);

sampleStart = 1;

while sampleStart <= numberOfSamples

    sampleEnd = min( ...
        sampleStart + blockSize - 1, ...
        numberOfSamples);

    audioBlock = source(sampleStart:sampleEnd);
    blockLength = length(audioBlock);

    % Time at the middle of the current block.
    timeSeconds = ...
        ((sampleStart - 1) + blockLength / 2) / sampleRate;

    % One cycle is start -> destination -> start.
    cycleLength = 2 * travelTime;
    cycleTime = mod(timeSeconds, cycleLength);

    if cycleTime <= travelTime

        % Start to destination.
        amount = cycleTime / travelTime;

    else

        % Destination to start.
        amount = 1 - ((cycleTime - travelTime) / travelTime);
    end

    % Linear interpolation of x, y, and z.
    currentPosition = ...
        (1 - amount) * startPosition + ...
        amount * endPosition;

    % Pure Left/Right earphone model:
    lateralY = currentPosition(2);
    referenceFrontX = max(0.5, abs(currentPosition(1)));
    azimuth = atan2d(lateralY, referenceFrontX);
    elevation = 0;
    distance = hypot(referenceFrontX, lateralY);

    if distance == 0
        distance = eps;
    end

    % Distance attenuation.
    gain = min(1, 1 / max(distance, 1));

    %% Get HRIR for current position

    if isempty(hrirData)

        [hrirLeft, hrirRight] = syntheticHrir( ...
            sampleRate, ...
            azimuth, ...
            elevation, ...
            speedOfSound, ...
            headRadius, ...
            elevationCueStrength);

    else

        hrirAzimuth = azimuth;
        hrirElevation = elevation;

        if isfield(hrirData, "isCipic") && hrirData.isCipic
            [hrirAzimuth, hrirElevation] = ...
                cipicDirection(currentPosition);
        end

        directionIndex = nearestDirection( ...
            hrirData.azimuth, ...
            hrirData.elevation, ...
            hrirAzimuth, ...
            hrirElevation);

        hrirLeft = hrirData.left(:, directionIndex);
        hrirRight = hrirData.right(:, directionIndex);

        if applyExtraITD

            itd = headRadius / speedOfSound * ...
                (deg2rad(azimuth) + sind(azimuth));

            if itd > 0
                hrirRight = fractionalDelay( ...
                    hrirRight, itd * sampleRate);
            elseif itd < 0
                hrirLeft = fractionalDelay( ...
                    hrirLeft, -itd * sampleRate);
            end
        end

        % Lateral HRTF cues remain measured. Add separate, deliberately strong
        % front/rear head-shadow and above/below pinna cues after HRIR
        % selection so depth and height survive ordinary headphones. Set
        % ElevationCueStrength=0 for research-pure measured HRIR playback.
        [hrirLeft, hrirRight] = addDirectionalDemoCue( ...
            hrirLeft, ...
            hrirRight, ...
            sampleRate, ...
            azimuth, ...
            elevation, ...
            elevationCueStrength);
    end

    % Equalize HRIR lengths.
    filterLength = max(length(hrirLeft), length(hrirRight));

    hrirLeft(end+1:filterLength, 1) = 0;
    hrirRight(end+1:filterLength, 1) = 0;

    %% FIR convolution for this block

    filteredLeft = conv(audioBlock, hrirLeft) * gain;
    filteredRight = conv(audioBlock, hrirRight) * gain;

    %% Add this block to the output

    outputStart = sampleStart;
    outputEnd = sampleStart + length(filteredLeft) - 1;

    if outputEnd > length(leftOutput)

        extraSamples = outputEnd - length(leftOutput);

        leftOutput(end+1:end+extraSamples) = 0;
        rightOutput(end+1:end+extraSamples) = 0;
    end

    leftOutput(outputStart:outputEnd) = ...
        leftOutput(outputStart:outputEnd) + filteredLeft;

    rightOutput(outputStart:outputEnd) = ...
        rightOutput(outputStart:outputEnd) + filteredRight;

    sampleStart = sampleEnd + 1;
end

binauralAudio = [leftOutput, rightOutput];

%% Normalize output

if normalizeOutput

    peakValue = max(abs(binauralAudio(:)));

    if peakValue > 0
        binauralAudio = ...
            0.98 * binauralAudio / peakValue;
    end
end

%% Write temporary WAV

temporaryWav = outputFile + ".temporary.wav";

audiowrite( ...
    temporaryWav, ...
    binauralAudio, ...
    sampleRate, ...
    "BitsPerSample", 24);

%% Replace existing MP3

if isfile(outputFile)
    delete(outputFile);
end

%% Convert WAV to MP3

ffmpegCommand = sprintf( ...
    '"%s" -y -i "%s" -codec:a libmp3lame -b:a %s "%s"', ...
    ffmpegPath, ...
    temporaryWav, ...
    mp3Bitrate, ...
    outputFile);

[status, commandOutput] = system(ffmpegCommand);

if isfile(temporaryWav)
    delete(temporaryWav);
end

if status ~= 0
    error("FFmpeg conversion failed:" + newline + commandOutput);
end

%% Return metadata

metadata = struct();

metadata.inputFile = inputFile;
metadata.outputFile = outputFile;
metadata.sampleRate = sampleRate;
metadata.startPosition = startPosition;
metadata.destinationPosition = endPosition;
metadata.travelTimeSeconds = travelTime;
metadata.cycleTimeSeconds = 2 * travelTime;
metadata.audioDurationSeconds = numberOfSamples / sampleRate;
metadata.outputFormat = "MP3";
metadata.mp3Bitrate = mp3Bitrate;
metadata.highPassHz = highPassHz;
metadata.noiseGateDb = noiseGateDb;
metadata.elevationCueStrength = 0;
metadata.directionalCueDescription = ...
    "Two-factor Left/Right earphone binaural rendering (ITD + ILD)";

end


%% ========================================================================
function output = removeRumble(input, sampleRate, cutoffHz)

if cutoffHz <= 0
    output = input;
    return;
end

alpha = exp(-2 * pi * cutoffHz / sampleRate);
output = zeros(size(input));
previousInput = 0;
previousOutput = 0;

for index = 1:length(input)
    previousOutput = alpha * ...
        (previousOutput + input(index) - previousInput);
    output(index) = previousOutput;
    previousInput = input(index);
end

end


%% ========================================================================
function output = applySoftNoiseGate(input, sampleRate, thresholdDb)

if ~isfinite(thresholdDb)
    output = input;
    return;
end

threshold = 10^(thresholdDb / 20);
windowLength = max(1, round(0.025 * sampleRate));
envelope = sqrt(movmean(input .^ 2, windowLength) + eps);

% Keep a small floor so quiet musical tails remain natural instead of being
% hard-muted. Signals above the threshold pass unchanged.
gain = min(1, max(0.12, envelope / max(threshold, eps)));
output = input .* gain;

end


%% ========================================================================
function [data, sampleRate] = loadHrir(fileName)

data = [];
sampleRate = [];

if strlength(fileName) == 0
    return;
end

if ~isfile(fileName)
    error("HRIR file not found: " + fileName);
end

loaded = load(fileName);

data.left = getField(loaded, ...
    {"hrirL", "hrir_l", "left"});

data.right = getField(loaded, ...
    {"hrirR", "hrir_r", "right"});

data.azimuth = getField(loaded, ...
    {"azimuth", "azimuths", "SourceAzimuth", "azim_v"});

data.elevation = getField(loaded, ...
    {"elevation", "elevations", "SourceElevation", "elev_v"});

sampleRate = getField(loaded, ...
    {"fs", "Fs", "sampleRate", "samplingRate"});

% Native CIPIC hrir_final.mat files contain only hrir_l/hrir_r, ITD and a
% subject name. The grid is documented by the CIPIC show_data program:
% 25 lateral angles and 50 elevation angles around the full sphere.
if isempty(data.azimuth) && isempty(data.elevation) && ...
        ~isempty(data.left) && ndims(data.left) == 3 && ...
        size(data.left, 1) == 25 && size(data.left, 2) == 50

    data.isCipic = true;

    % CIPIC's positive lateral angles point to the opposite ear from this
    % application's +Y-left convention, so mirror the grid while retaining
    % the measured left/right channels.
    data.azimuth = -[-80 -65 -55 -45 -40 -35 -30 -25 -20 -15 ...
        -10 -5 0 5 10 15 20 25 30 35 40 45 55 65 80];
    data.elevation = -45:(360 / 64):235;

    % CIPIC standard HRIRs use 200 taps at 44.1 kHz and do not store fs.
    if isempty(sampleRate) && size(data.left, 3) == 200
        sampleRate = 44100;
    end
end

if ~isfield(data, "isCipic")
    data.isCipic = false;
end

if isempty(data.left) || isempty(data.right)
    error("HRIR file must contain left and right HRIR arrays.");
end

if isempty(data.azimuth) || isempty(data.elevation)
    error("HRIR file must contain azimuth and elevation arrays.");
end

data.left = double(data.left);
data.right = double(data.right);
data.azimuth = double(data.azimuth(:));
data.elevation = double(data.elevation(:));

if ndims(data.left) == 3

    % Format: [azimuth x elevation x samples]
    numberOfAzimuths = length(data.azimuth);
    numberOfElevations = length(data.elevation);

    if size(data.left, 1) ~= numberOfAzimuths || ...
            size(data.left, 2) ~= numberOfElevations

        error("Unsupported 3-D HRIR dimensions.");
    end

    data.left = reshape( ...
        permute(data.left, [3 1 2]), ...
        size(data.left, 3), []);

    data.right = reshape( ...
        permute(data.right, [3 1 2]), ...
        size(data.right, 3), []);

    [azimuthGrid, elevationGrid] = ...
        ndgrid(data.azimuth, data.elevation);

    data.azimuth = azimuthGrid(:);
    data.elevation = elevationGrid(:);

else

    % Format: [samples x directions]
    if size(data.left, 2) == length(data.azimuth)

        % Already correct.

    % Format: [directions x samples]
    elseif size(data.left, 1) == length(data.azimuth)

        data.left = data.left.';
        data.right = data.right.';

    else
        error("HRIR directions do not match direction arrays.");
    end
end

if ~isempty(sampleRate)
    sampleRate = double(sampleRate);
end

end


%% ========================================================================
function data = resampleHrirData(data, sourceRate, targetRate)

if sourceRate <= 0 || targetRate <= 0
    error("HRIR sample rates must be positive.");
end

oldLength = size(data.left, 1);
newLength = max(1, round(oldLength * targetRate / sourceRate));
oldTime = (0:oldLength - 1).' / sourceRate;
newTime = (0:newLength - 1).' / targetRate;

data.left = interp1(oldTime, data.left, newTime, "linear", 0);
data.right = interp1(oldTime, data.right, newTime, "linear", 0);

end


%% ========================================================================
function value = getField(data, names)

value = [];

for k = 1:length(names)

    if isfield(data, names{k})
        value = data.(names{k});
        return;
    end
end

end


%% ========================================================================
function [azimuth, elevation] = cipicDirection(position)

% CIPIC samples vertical cones. In its convention, elevation 0 is the
% forward horizontal plane, 90 is above, 180 is behind and 270 is below.
% Re-express the application's +X-front/+Y-left/+Z-above coordinates so the
% measured grid is selected correctly around the rear and lower hemispheres.
x = position(1);
y = position(2);
z = position(3);
horizontalDistance = hypot(x, y);

if x >= 0
    azimuth = atan2d(y, x);
    elevation = atan2d(z, horizontalDistance);
else
    azimuth = atan2d(y, -x);
    elevation = 180 - atan2d(z, horizontalDistance);
end

end


%% ========================================================================
function index = nearestDirection( ...
    azimuthGrid, elevationGrid, targetAzimuth, targetElevation)

azimuthDifference = mod( ...
    azimuthGrid - targetAzimuth + 180, 360) - 180;

elevationDifference = ...
    elevationGrid - targetElevation;

distance = hypot( ...
    azimuthDifference, elevationDifference);

[~, index] = min(distance);

end


%% ========================================================================
function [left, right] = addDirectionalDemoCue( ...
    left, right, sampleRate, azimuth, elevation, strength)

% Elevation and front/rear demo cues are disabled for pure Left/Right earphones rendering.
return;

% Front/back is not represented by ITD when the source is centered. Use a
% measured-HRTF-compatible head-shadow/pinna profile instead: rear sources are
% darker, notched around the pinna resonances, and receive a short cavity
% reflection. Front sources are left dry so the contrast is easy to hear.
frontness = cosd(azimuth);
rearAmount = max(0, min(1, (1 - frontness) / 2));
left = applyRearCue(left, sampleRate, rearAmount, strength);
right = applyRearCue(right, sampleRate, rearAmount, strength);

if abs(elevation) < 1e-6
    return;
end

signedElevation = sind(elevation);
perceptualElevation = sign(signedElevation) * min(1, ...
    sqrt(abs(signedElevation)) * strength);
aboveAmount = max(perceptualElevation, 0);
belowAmount = max(-perceptualElevation, 0);

% 4-10 ms reflections are long enough to read as a height/ceiling cue rather
% than a tiny HRIR notch, but short enough to avoid sounding like an echo.
reflectionDelayOne = max(1, round(sampleRate * ...
    (0.0040 + 0.0025 * aboveAmount + 0.0015 * belowAmount)));
reflectionDelayTwo = reflectionDelayOne + max(1, round(sampleRate * ...
    (0.0020 + 0.0015 * aboveAmount + 0.0010 * belowAmount)));

reflectionGainOne = 0.72 * aboveAmount + 0.48 * belowAmount;
reflectionGainTwo = 0.38 * aboveAmount + 0.22 * belowAmount;

cue = zeros(reflectionDelayTwo + 1, 1);
cue(1) = 1;
cue(1 + reflectionDelayOne) = reflectionGainOne;
cue(1 + reflectionDelayTwo) = reflectionGainTwo;

left = conv(left, cue);
right = conv(right, cue);

% A deliberately broad shelf makes the height contrast survive dense music.
% Low frequencies remain anchored, while the high band becomes brighter above
% and substantially darker below.
left = applyHeightShelf(left, sampleRate, perceptualElevation);
right = applyHeightShelf(right, sampleRate, perceptualElevation);

end


%% ========================================================================
function output = applyRearCue(input, sampleRate, rearAmount, strength)

if rearAmount < 1e-6 || strength <= 0
    output = input;
    return;
end

rearStrength = min(2, strength) / 1.8;

% An 8-20 ms cavity reflection makes a rear source temporally different from
% a dry front source. This is intentionally audible as a short rear slapback
% in the demo; a future room model can replace it with a measured BRIR.
reflectionDelayOne = max(1, round(sampleRate * ...
    (0.0080 + 0.0040 * rearAmount)));
reflectionDelayTwo = reflectionDelayOne + max(1, round(sampleRate * ...
    (0.0060 + 0.0020 * rearAmount)));
reflectionGainOne = (0.42 + 0.30 * rearAmount) * rearStrength;
reflectionGainTwo = (0.20 + 0.18 * rearAmount) * rearStrength;
cue = zeros(reflectionDelayTwo + 1, 1);
cue(1) = 1;
cue(1 + reflectionDelayOne) = reflectionGainOne;
cue(1 + reflectionDelayTwo) = reflectionGainTwo;
output = conv(input, cue);

% Head shadow: preserve bass/low mids but strongly attenuate the high band at
% the rear. This is separate from the lateral HRTF/ILD, so a centered source
% can still be distinguished as front versus back.
rearHighGain = max(0.06, 1 - 0.94 * rearAmount * rearStrength);
output = applySpectralShelf(output, sampleRate, rearHighGain, 1800);

% Pinna notches provide an additional front/back spectral fingerprint.
notchOneDelay = max(1, round(sampleRate / (2 * 2800)));
notchTwoDelay = max(1, round(sampleRate / (2 * 4700)));
notchDepthOne = 0.28 * rearAmount * rearStrength;
notchDepthTwo = 0.18 * rearAmount * rearStrength;

notchOne = zeros(notchOneDelay + 1, 1);
notchOne(1) = 1 + notchDepthOne;
notchOne(end) = -notchDepthOne;
notchTwo = zeros(notchTwoDelay + 1, 1);
notchTwo(1) = 1 + notchDepthTwo;
notchTwo(end) = -notchDepthTwo;
output = conv(conv(output, notchOne), notchTwo);

end


%% ========================================================================
function output = applyHeightShelf(input, sampleRate, signedAmount)

if abs(signedAmount) < 1e-6
    output = input;
    return;
end

heightAmount = min(1, abs(signedAmount));
if signedAmount > 0
    highBandGain = 1 + 2.4 * heightAmount;
else
    highBandGain = 0.22 + 0.78 * (1 - heightAmount);
end

output = applySpectralShelf(input, sampleRate, highBandGain, 2400);

end


%% ========================================================================
function output = applySpectralShelf(input, sampleRate, highBandGain, cutoffHz)

% One-pole low/high split, implemented without Signal Processing Toolbox.
alpha = exp(-2 * pi * cutoffHz / sampleRate);
output = zeros(size(input));
lowPart = 0;

for index = 1:length(input)
    lowPart = (1 - alpha) * input(index) + alpha * lowPart;
    highPart = input(index) - lowPart;
    output(index) = lowPart + highBandGain * highPart;
end

end


%% ========================================================================
function [left, right] = syntheticHrir( ...
    sampleRate, azimuth, elevation, speedOfSound, headRadius, ...
    elevationCueStrength)

% Pure 2-factor Left & Right earphone binaural model:
% Factor 1: ITD (Interaural Time Difference) via Woodworth spherical head model
% Factor 2: ILD (Interaural Level Difference) & Acoustic Head Shadow low-pass

% Clamp azimuth to [-90, 90] degrees where +90 = Left earphone, -90 = Right earphone.
theta = max(-90, min(90, azimuth));

% Factor 1: ITD (Woodworth formula)
% tau = (r / c) * (theta_rad + sin(theta_rad))
thetaRad = deg2rad(abs(theta));
itdSeconds = (headRadius / speedOfSound) * (thetaRad + sin(thetaRad));
itdSamples = itdSeconds * sampleRate;

% Factor 2: ILD (Level difference in dB, up to ~8.5 dB at full 90 degrees)
ildDb = min(9.0, (abs(theta) / 90) * 8.5);
attenuationLinear = 10^(-ildDb / 20);

% Base direct impulse (unit impulse with minimal length)
baseImpulse = [1; zeros(2, 1)];

% Head shadow filter for the shadowed ear:
% The human head acts as an acoustic baffle for frequencies > 1.5 kHz.
% For the ear further away, apply high-frequency acoustic shadowing.
if abs(theta) > 0.1
    % Acoustic shadowing shelf: low frequencies pass, highs attenuated
    shadowHighGain = max(0.20, 1.0 - 0.75 * (abs(theta) / 90));
    shadowFilter = applySpectralShelf(baseImpulse, sampleRate, shadowHighGain, 1500);
else
    shadowFilter = baseImpulse;
end

if theta > 0
    % Source is closer to LEFT earphone:
    % Left ear gets direct sound at full level
    left = baseImpulse;
    % Right ear gets delayed sound (ITD) and attenuated/shadowed sound (ILD)
    right = fractionalDelay(shadowFilter * attenuationLinear, itdSamples);
elseif theta < 0
    % Source is closer to RIGHT earphone:
    % Right ear gets direct sound at full level
    right = baseImpulse;
    % Left ear gets delayed sound (ITD) and attenuated/shadowed sound (ILD)
    left = fractionalDelay(shadowFilter * attenuationLinear, itdSamples);
else
    % Center: identical signals at both earphones (zero delay, zero level difference)
    left = baseImpulse;
    right = baseImpulse;
end

end


%% ========================================================================
function delayed = fractionalDelay(signal, delaySamples)

integerDelay = floor(delaySamples);
fraction = delaySamples - integerDelay;

delayed = [zeros(integerDelay, 1); signal];

if fraction > 0

    delayed = [delayed; 0];

    delayed = ...
        (1 - fraction) * delayed + ...
        fraction * [0; delayed(1:end-1)];
end

end
