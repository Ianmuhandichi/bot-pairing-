{ pkgs }: {
  deps = [
    pkgs.python3
    pkgs.nodejs_20
    pkgs.gcc
    pkgs.openssl
    pkgs.sqlite
  ];
  
  env = {
    LD_LIBRARY_PATH = "${pkgs.stdenv.cc.cc.lib}/lib";
    PYTHONPATH = "${pkgs.python3}/lib/python3.10/site-packages/";
  };
}
