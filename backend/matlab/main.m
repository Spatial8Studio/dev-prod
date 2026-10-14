clear;
clc;

% Input and output files
inputFile = "input.mp3";
outputFile = "spatial_output.mp3";

% Source coordinates [x y z]
% +X = forward
% +Y = left
% +Z = upward
sourcePosition = [0 0 4];

% Process audio using the synthetic test HRIR
% This does not require a measured HRTF database.
metadata = spatializeAudio( ...
    inputFile, ...
    outputFile, ...
    sourcePosition, ...
    'AllowSynthetic', true, ...
    'FfmpegPath', "ffmpeg", ...
    'Mp3Bitrate', "320k");

disp("Spatial audio processing completed.");
disp(metadata);
