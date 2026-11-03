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
% Height cues are deliberately exaggerated for the demo. Set to zero for
% the unmodified measured HRIR response.
elevationCueStrength = 1.8;

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

    distance = norm(currentPosition);

    if distance == 0
        distance = eps;
    end

    azimuth = atan2d( ...
        currentPosition(2), ...
        currentPosition(1));

    elevation = asind( ...
        currentPosition(3) / distance);

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

        % Measured HRTFs can still sound nearly identical for front and
        % overhead positions on ordinary headphones. Add a short, directional
        % pinna/ceiling cue after HRIR selection so the height difference is
        % obvious in the demo. Set ElevationCueStrength=0 for research-pure
        % measured HRIR playback.
        [hrirLeft, hrirRight] = addElevationDemoCue( ...
            hrirLeft, ...
            hrirRight, ...
            sampleRate, ...
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
metadata.elevationCueStrength = elevationCueStrength;

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
function [left, right] = addElevationDemoCue( ...
    left, right, sampleRate, elevation, strength)

% ADDELEVATIONDEMO CUE adds an intentionally obvious height signature.
% A real HRTF's elevation cues are often only a few dB and are easy to lose
% on laptop speakers. This cue combines a short ceiling/pinna reflection with
% a signed high-frequency shelf: above is brighter and reflected, below is
% darker and reflected differently, while front (elevation ~= 0) is untouched.

if strength <= 0 || abs(elevation) < 1e-6
    return;
end

signedElevation = sind(elevation);
perceptualElevation = sign(signedElevation) * min(1, ...
    sqrt(abs(signedElevation)) * strength);
aboveAmount = max(perceptualElevation, 0);
belowAmount = max(-perceptualElevation, 0);

% 4-9 ms reflections are long enough to read as a height/ceiling cue rather
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

% One-pole low/high split, implemented without Signal Processing Toolbox.
cutoffHz = 2400;
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

% Testing-only synthetic HRIR with lateral, elevation and front/back cues.
% Use a measured HRTF database for final project results. This model makes
% the fallback less ambiguous, but it does not replace measured HRIRs.

itdSeconds = headRadius / speedOfSound * ...
    (deg2rad(azimuth) + sind(azimuth));

itdSamples = abs(itdSeconds * sampleRate);

% cos(azimuth) is 1 directly in front and -1 directly behind. A rear
% source receives a high-frequency roll-off that approximates head and pinna
% shadowing. Elevation is intentionally more pronounced in the synthetic
% fallback: an overhead source receives a bright spectral shelf, a shifted
% pinna notch and a stronger early reflection. This is not a replacement for
% a measured HRTF, but it makes front/above/below positions distinguishable
% when no HRIR file is configured.
frontness = cosd(azimuth);
rearAmount = (1 - frontness) / 2;
elevationAmount = max(-1, min(1, sind(elevation)));

% Elevation is perceptually difficult to hear at small angles. A square-root
% curve plus a demo strength makes a 20-30 degree source receive a useful cue
% while preserving the sign (above versus below). The same strength is also
% used by the measured-HRIR enhancement below.
perceptualElevation = sign(elevationAmount) * min(1, ...
    sqrt(abs(elevationAmount)) * max(0, elevationCueStrength));
aboveAmount = max(perceptualElevation, 0);
belowAmount = max(-perceptualElevation, 0);

% The two-tap shelf preserves DC level but changes treble by several dB. This
% is intentionally stronger than a subtle HRTF cue because the fallback has to
% remain audible on ordinary headphones and laptop speakers.
verticalShelf = 0.52 * perceptualElevation;

% Real pinnae create more than one elevation-dependent spectral notch. Two
% notches plus two short reflections are much easier to distinguish from a
% straight-ahead source than a single shallow comb filter.
notchFrequencyOne = 5600 - 1400 * perceptualElevation + 700 * rearAmount;
notchFrequencyTwo = 9300 - 1200 * perceptualElevation + 900 * rearAmount;
notchDelayOne = max(2, round(sampleRate / (2 * notchFrequencyOne)));
notchDelayTwo = max(notchDelayOne + 1, ...
    round(sampleRate / (2 * notchFrequencyTwo)));
notchDepthOne = 0.04 + 0.48 * abs(perceptualElevation) + ...
    0.12 * rearAmount;
notchDepthTwo = 0.02 + 0.28 * abs(perceptualElevation) + ...
    0.05 * rearAmount;

reflectionDelayOne = max(notchDelayTwo + 1, round(sampleRate * ...
    (0.00022 + 0.00450 * aboveAmount + ...
     0.00350 * belowAmount + 0.00030 * rearAmount)));
reflectionDelayTwo = reflectionDelayOne + max(1, round(sampleRate * ...
    (0.00180 + 0.00200 * aboveAmount + ...
     0.00150 * belowAmount + 0.00025 * rearAmount)));
reflectionGainOne = 0.02 + 0.68 * aboveAmount + ...
    0.44 * belowAmount + 0.10 * rearAmount;
reflectionGainTwo = 0.01 + 0.36 * aboveAmount + ...
    0.20 * belowAmount + 0.05 * rearAmount;

filterLength = reflectionDelayTwo + 1;
directionalFilter = zeros(filterLength, 1);
% Keep the low-frequency/DC gain near one while carving the two pinna notches.
directionalFilter(1) = 1 + notchDepthOne + notchDepthTwo;
directionalFilter(1 + notchDelayOne) = -notchDepthOne;
directionalFilter(1 + notchDelayTwo) = ...
    directionalFilter(1 + notchDelayTwo) - notchDepthTwo;
directionalFilter(1 + reflectionDelayOne) = reflectionGainOne;
directionalFilter(1 + reflectionDelayTwo) = reflectionGainTwo;

% The rear low-pass section creates a stable front/back spectral contrast.
% Its coefficients sum to one so it does not introduce a level jump while
% a source moves across the listener.
rearFilter = [1 - 0.75 * rearAmount; 0.55 * rearAmount; ...
    0.20 * rearAmount];
baseImpulse = conv(directionalFilter, rearFilter);

% Apply the signed vertical shelf after the pinna response. For an elevated
% source [1+g, -g] keeps the low end intact while lifting the high end; for a
% source below the listener the same operation becomes a gentle low-pass.
baseImpulse = conv(baseImpulse, [1 + verticalShelf; -verticalShelf]);

% Use the same broad, signed height shelf as measured HRIR playback so the
% no-dataset fallback remains unmistakable on normal headphones.
baseImpulse = applyHeightShelf( ...
    baseImpulse, sampleRate, perceptualElevation);

left = baseImpulse;
right = baseImpulse;

% Simple ILD approximation.
levelDifference = ...
    10^(min(6, abs(azimuth) / 90 * 6) / 20);

if itdSeconds > 0

    % Source is on the left.
    right = fractionalDelay(right, itdSamples);
    left = left * levelDifference;

elseif itdSeconds < 0

    % Source is on the right.
    left = fractionalDelay(left, itdSamples);
    right = right * levelDifference;
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
