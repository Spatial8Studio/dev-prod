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

%% Load measured HRIR data if supplied

[hrirData, hrirSampleRate] = loadHrir(hrirFile);

if ~isempty(hrirSampleRate) && hrirSampleRate ~= sampleRate
    error("Input and HRIR sample rates must be equal.");
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
blockNumber = 1;
previousTailLeft = [];
previousTailRight = [];

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
            speedOfSound, ...
            headRadius);

    else

        directionIndex = nearestDirection( ...
            hrirData.azimuth, ...
            hrirData.elevation, ...
            azimuth, ...
            elevation);

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
    end

    % Equalize HRIR lengths.
    filterLength = max(length(hrirLeft), length(hrirRight));

    hrirLeft(end+1:filterLength, 1) = 0;
    hrirRight(end+1:filterLength, 1) = 0;

    %% FIR convolution for this block

    filteredLeft = conv(audioBlock, hrirLeft) * gain;
    filteredRight = conv(audioBlock, hrirRight) * gain;

    % Crossfade the beginning of a block with the previous block tail.
    fadeLength = min( ...
        round(0.01 * sampleRate), ...
        min(length(filteredLeft), length(filteredRight)));

    if blockNumber > 1 && ~isempty(previousTailLeft)

        fadeLength = min(fadeLength, length(previousTailLeft));
        fadeLength = min(fadeLength, length(previousTailRight));

        fadeIn = linspace(0, 1, fadeLength).';
        fadeOut = 1 - fadeIn;

        filteredLeft(1:fadeLength) = ...
            filteredLeft(1:fadeLength) .* fadeIn + ...
            previousTailLeft(1:fadeLength) .* fadeOut;

        filteredRight(1:fadeLength) = ...
            filteredRight(1:fadeLength) .* fadeIn + ...
            previousTailRight(1:fadeLength) .* fadeOut;
    end

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

    previousTailLeft = filteredLeft;
    previousTailRight = filteredRight;

    sampleStart = sampleEnd + 1;
    blockNumber = blockNumber + 1;
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
function [left, right] = syntheticHrir( ...
    sampleRate, azimuth, speedOfSound, headRadius)

% Testing-only synthetic HRIR.
% Use a measured HRIR database for final project results.

itdSeconds = headRadius / speedOfSound * ...
    (deg2rad(azimuth) + sind(azimuth));

itdSamples = abs(itdSeconds * sampleRate);

baseImpulse = [1; 0.15; 0.05];

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
