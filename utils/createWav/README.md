### Using createWav

createWav.py requires poetry to use.  Please install (here)[https://python-poetry.org/docs/master/#installation].

Then, install dependcies with `poetry install`

### To Use

`poetry run python createWav.py`

### Parameters

- `-file`: Name of the file to be created.  File will be created in the ..\wav_files directory.  Do not append with '.wav'

- `-text`: Text of the file to be created using Polly.  

### Example

`poetry run python createWav.py -file connectingYou -text "Please wait while I connect you"`